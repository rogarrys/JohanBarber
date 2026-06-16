/* ============================================================
   JOHAN · Barbier — Serveur (sans dépendance externe)
   - Sert le site (index.html, styles.css, script.js, assets/)
   - API de réservation, enregistrée dans data/bookings.json
   - Notifie le coiffeur via un bot Telegram
   Démarrage : node server.js   (ou: npm start)
   ============================================================ */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "bookings.json");

/* ---------- charge .env si présent (pas besoin de dépendance) ---------- */
(function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = val;
  }
})();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const PORT = process.env.PORT || process.argv[2] || 3000;

/* ---------- prestations + créneaux valides (source de vérité serveur) ---------- */
const SERVICES = {
  "coupe": { label: "Coupe", price: 15, minutes: 30 },
  "coupe-barbe": { label: "Coupe + Barbe", price: 20, minutes: 45 },
};
const SLOTS = (() => {
  const out = [];
  for (let m = 11 * 60; m <= 19 * 60 + 30; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
})();

const fmtDateFR = (ymd) =>
  new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(ymd + "T00:00:00"));

/* ---------- stockage (fichier JSON) ---------- */
function loadStore() {
  try { return JSON.parse(readFileSync(DATA_FILE, "utf8")); }
  catch { return { bookings: [] }; }
}
function saveStore(store) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}
let store = loadStore();

function bookedMap() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const map = {};
  for (const b of store.bookings) {
    if (new Date(b.date + "T00:00:00") < today) continue; // ignore le passé
    (map[b.date] ||= []).push(b.time);
  }
  return map;
}
const isTaken = (date, time) => store.bookings.some((b) => b.date === date && b.time === time);

/* ---------- Telegram ---------- */
async function notifyTelegram(b) {
  if (!TOKEN || !CHAT_ID) {
    console.warn("[telegram] non configuré (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) — notification ignorée");
    return false;
  }
  const text =
    `📅 *Nouvelle réservation*\n\n` +
    `✂️ ${b.serviceLabel} — ${b.price}€\n` +
    `🗓️ ${b.dateLabel} à *${b.time}*\n` +
    `👤 ${b.name}\n` +
    `📞 ${b.phone}`;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown" }),
    });
    const json = await res.json();
    if (!json.ok) console.error("[telegram] échec:", json.description || json);
    return !!json.ok;
  } catch (e) {
    console.error("[telegram] erreur réseau:", e.message);
    return false;
  }
}

/* ---------- utils HTTP ---------- */
const json = (res, code, obj) => {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(obj));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e5) { reject(new Error("payload trop volumineux")); req.destroy(); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end("Forbidden"); return; }
  // ne pas exposer les fichiers sensibles
  const base = path.basename(filePath);
  if (base === ".env" || filePath.startsWith(DATA_DIR)) { res.writeHead(404); res.end("Not found"); return; }
  readFile(filePath)
    .then((buf) => {
      res.writeHead(200, { "content-type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
      res.end(buf);
    })
    .catch(() => { res.writeHead(404); res.end("Not found"); });
}

/* ---------- routes API ---------- */
async function handleBook(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch { return json(res, 400, { ok: false, error: "json_invalide" }); }

  const service = String(payload.service || "");
  const date = String(payload.date || "");
  const time = String(payload.time || "");
  const name = String(payload.name || "").trim();
  const phone = String(payload.phone || "").trim();

  // validations
  if (!SERVICES[service]) return json(res, 400, { ok: false, error: "prestation_invalide" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { ok: false, error: "date_invalide" });
  if (!SLOTS.includes(time)) return json(res, 400, { ok: false, error: "heure_invalide" });
  if (name.length < 2) return json(res, 400, { ok: false, error: "nom_invalide" });
  if (phone.replace(/\D/g, "").length < 9) return json(res, 400, { ok: false, error: "tel_invalide" });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (new Date(date + "T00:00:00") < today) return json(res, 400, { ok: false, error: "date_passee" });

  if (isTaken(date, time)) return json(res, 409, { ok: false, error: "creneau_pris" });

  const svc = SERVICES[service];
  const booking = {
    id: `${date}-${time}-${Math.random().toString(36).slice(2, 8)}`,
    service, serviceLabel: svc.label, price: svc.price,
    date, dateLabel: fmtDateFR(date), time,
    name, phone,
    createdAt: new Date().toISOString(),
  };

  store.bookings.push(booking);
  saveStore(store);

  const notified = await notifyTelegram(booking);
  console.log(`[résa] ${booking.dateLabel} ${time} — ${svc.label} — ${name} (${phone})${notified ? " ✓ Telegram" : ""}`);

  return json(res, 200, { ok: true, id: booking.id, notified });
}

/* ---------- serveur ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");

  if (url.pathname.startsWith("/api/")) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      return res.end();
    }
    if (url.pathname === "/api/booked" && req.method === "GET") {
      return json(res, 200, { ok: true, booked: bookedMap() });
    }
    if (url.pathname === "/api/book" && req.method === "POST") {
      try { return await handleBook(req, res); }
      catch (e) { return json(res, 500, { ok: false, error: "serveur" }); }
    }
    return json(res, 404, { ok: false, error: "route_inconnue" });
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  JOHAN · serveur lancé → http://localhost:${PORT}`);
  console.log(`  Réservations : ${store.bookings.length} enregistrée(s) dans data/bookings.json`);
  console.log(`  Telegram     : ${TOKEN && CHAT_ID ? "configuré ✓" : "NON configuré (voir README)"}\n`);
});
