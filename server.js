/* ============================================================
   JOHAN · Barbier — Serveur (sans dépendance externe)
   - Sert le site + le panel admin
   - API réservation (data/bookings.json)
   - Réglages horaires gérés par l'admin (data/settings.json)
   - Notifications : Telegram + e-mail
   Démarrage : npm start
   ============================================================ */

import http from "node:http";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");
const BOOK_FILE = path.join(DATA_DIR, "bookings.json");
const SET_FILE = path.join(DATA_DIR, "settings.json");

/* ---------- charge .env si présent ---------- */
(function loadEnv() {
  const p = path.join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SECRET = process.env.ADMIN_SECRET || ("johan-" + ADMIN_PASSWORD);
const EMAIL_API_KEY = process.env.EMAIL_API_KEY || "";
const EMAIL_TO = process.env.EMAIL_TO || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "JOHAN Barbier <onboarding@resend.dev>";
const PORT = process.env.PORT || process.argv[2] || 3000;

/* ---------- prestations ---------- */
const SERVICES = {
  "coupe": { label: "Coupe", price: 15, minutes: 45 },
  "coupe-barbe": { label: "Coupe + Barbe", price: 20, minutes: 45 },
};

/* ---------- réglages (modifiables par l'admin) ----------
   Planning par jour : schedule[0..6] (0=dimanche ... 6=samedi),
   chaque jour = { open, openTime, closeTime }. */
const newDay = (open = true, openTime = "11:00", closeTime = "21:00") => ({ open, openTime, closeTime });
const DEFAULT_SETTINGS = {
  step: 30,
  schedule: { 0: newDay(), 1: newDay(), 2: newDay(), 3: newDay(), 4: newDay(), 5: newDay(), 6: newDay() },
  closedDates: [],   // jours de congé ponctuels : ["2026-07-14", ...]
  blockedSlots: {},  // créneaux bloqués : { "2026-06-20": ["14:00"] }
  notifyEmail: "",   // adresse e-mail de réception (via .env de préférence)
};

/* ---------- utils ---------- */
const pad2 = (n) => String(n).padStart(2, "0");
const hhmmToMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const minToHHMM = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const ymdToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const fmtDateFR = (ymd) =>
  new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(ymd + "T00:00:00"));

const dowOf = (date) => new Date(date + "T00:00:00").getDay();
function genSlotsForDow(dow) {
  const dc = settings.schedule[dow];
  if (!dc || !dc.open) return [];
  const out = [];
  const open = hhmmToMin(dc.openTime), close = hhmmToMin(dc.closeTime);
  for (let m = open; m <= close - settings.step; m += settings.step) out.push(minToHHMM(m));
  return out;
}

/* ---------- stockage ---------- */
function loadJSON(file, fallback) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
}
function saveJSON(file, obj) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(obj, null, 2));
}
let store = loadJSON(BOOK_FILE, { bookings: [] });

// Normalise les réglages chargés (et migre l'ancien format global → planning par jour)
function normalizeSettings(loaded) {
  loaded = loaded || {};
  const s = {
    step: [15, 20, 30, 45, 60].includes(Number(loaded.step)) ? Number(loaded.step) : 30,
    closedDates: Array.isArray(loaded.closedDates) ? loaded.closedDates : [],
    blockedSlots: loaded.blockedSlots && typeof loaded.blockedSlots === "object" ? loaded.blockedSlots : {},
    notifyEmail: typeof loaded.notifyEmail === "string" ? loaded.notifyEmail : "",
    schedule: {},
  };
  for (let d = 0; d < 7; d++) {
    const src = loaded.schedule && (loaded.schedule[d] || loaded.schedule[String(d)]);
    if (src) {
      s.schedule[d] = newDay(!!src.open, src.openTime || "11:00", src.closeTime || "21:00");
    } else if (loaded.openTime || loaded.closeTime || loaded.openDays) {
      const od = Array.isArray(loaded.openDays) ? loaded.openDays : [0, 1, 2, 3, 4, 5, 6];
      s.schedule[d] = newDay(od.includes(d), loaded.openTime || "11:00", loaded.closeTime || "21:00");
    } else {
      s.schedule[d] = newDay();
    }
  }
  return s;
}
let settings = normalizeSettings(loadJSON(SET_FILE, {}));

const isTaken = (date, time) => store.bookings.some((b) => b.date === date && b.time === time);
const isBlocked = (date, time) => Array.isArray(settings.blockedSlots[date]) && settings.blockedSlots[date].includes(time);

function unavailableMap() {
  const today = ymdToday();
  const map = {};
  const add = (date, time) => { if (new Date(date + "T00:00:00") >= today) (map[date] ||= []).push(time); };
  for (const b of store.bookings) add(b.date, b.time);
  for (const [date, times] of Object.entries(settings.blockedSlots)) for (const t of times) add(date, t);
  return map;
}
function dateIsOpen(date) {
  const dc = settings.schedule[dowOf(date)];
  return !!(dc && dc.open) && !settings.closedDates.includes(date);
}

/* ---------- notifications ---------- */
async function notifyTelegram(b) {
  if (!TG_TOKEN || !TG_CHAT) { console.warn("[telegram] non configuré"); return false; }
  const text =
    `📅 *Nouvelle réservation*\n\n✂️ ${b.serviceLabel} — ${b.price}€\n` +
    `🗓️ ${b.dateLabel} à *${b.time}*\n👤 ${b.name}\n📞 ${b.phone}`;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "Markdown" }),
    });
    const j = await r.json();
    if (!j.ok) console.error("[telegram] échec:", j.description || j);
    return !!j.ok;
  } catch (e) { console.error("[telegram]", e.message); return false; }
}

function buildEmailHTML(b) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const dateCap = cap(b.dateLabel);
  const tel = String(b.phone).replace(/[^\d+]/g, "");
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f0ed;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f0ed;padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:480px;background:#ffffff;border:1px solid #e7e6e2;border-radius:18px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;">

      <tr><td style="background:#18181a;padding:24px 30px;">
        <span style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:4px;">JOHAN</span>
        <span style="color:#8a8a8c;font-size:11px;letter-spacing:3px;">&nbsp;&nbsp;BARBIER</span>
      </td></tr>

      <tr><td style="padding:30px 30px 8px;">
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:2.5px;color:#d8341f;font-weight:bold;">NOUVELLE RÉSERVATION</p>
        <h1 style="margin:0;font-size:28px;line-height:1.15;color:#18181a;font-weight:800;">${esc(b.serviceLabel)}</h1>
      </td></tr>

      <tr><td style="padding:18px 30px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;border:1px solid #ecebe7;border-radius:14px;">
          <tr><td style="padding:18px 20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size:13px;color:#7a7a7c;padding:6px 0;">Jour</td>
                <td align="right" style="font-size:16px;color:#18181a;font-weight:bold;padding:6px 0;">${esc(dateCap)}</td>
              </tr>
              <tr><td colspan="2" style="border-top:1px solid #ecebe7;font-size:0;line-height:0;">&nbsp;</td></tr>
              <tr>
                <td style="font-size:13px;color:#7a7a7c;padding:6px 0;">Heure</td>
                <td align="right" style="font-size:26px;color:#18181a;font-weight:800;padding:6px 0;">${esc(b.time)}</td>
              </tr>
              <tr><td colspan="2" style="border-top:1px solid #ecebe7;font-size:0;line-height:0;">&nbsp;</td></tr>
              <tr>
                <td style="font-size:13px;color:#7a7a7c;padding:6px 0;">Tarif</td>
                <td align="right" style="font-size:18px;color:#d8341f;font-weight:bold;padding:6px 0;">${b.price}&nbsp;€</td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:24px 30px 6px;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:2.5px;color:#9a9a9b;font-weight:bold;">CLIENT</p>
        <p style="margin:0;font-size:20px;color:#18181a;font-weight:bold;">${esc(b.name)}</p>
        <p style="margin:4px 0 0;font-size:15px;color:#7a7a7c;">${esc(b.phone)}</p>
      </td></tr>

      <tr><td style="padding:18px 30px 30px;">
        <a href="tel:${tel}" style="display:inline-block;background:#18181a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:13px 26px;border-radius:999px;">Appeler ${esc(b.name)}</a>
      </td></tr>

      <tr><td style="padding:18px 30px;border-top:1px solid #efeee9;background:#faf9f6;">
        <p style="margin:0;font-size:12px;color:#9a9a9b;line-height:1.5;">Réservation reçue via le site &middot; 9 allée François Vayva<br>11h&ndash;21h &middot; sur rendez-vous</p>
      </td></tr>

    </table>
    <p style="margin:16px 0 0;font-size:11px;color:#b7b6b1;font-family:Helvetica,Arial,sans-serif;">JOHAN Barbier &middot; notification automatique</p>
  </td></tr>
</table>
</body></html>`;
}

async function notifyEmail(b) {
  const to = (settings.notifyEmail || EMAIL_TO || "").trim();
  if (!EMAIL_API_KEY || !to) { console.warn("[email] non envoyé (clé API ou adresse manquante)"); return false; }
  const html = buildEmailHTML(b);
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${EMAIL_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject: `RDV ${b.dateLabel} ${b.time} — ${b.name}`, html }),
    });
    if (!r.ok) { console.error("[email] échec:", await r.text()); return false; }
    return true;
  } catch (e) { console.error("[email]", e.message); return false; }
}

/* ---------- auth admin (token signé, sans état) ---------- */
function makeToken() {
  const payload = String(Date.now() + 7 * 24 * 3600 * 1000); // expire dans 7 jours
  const sig = crypto.createHmac("sha256", ADMIN_SECRET).update(payload).digest("hex");
  return Buffer.from(payload).toString("base64url") + "." + sig;
}
function checkToken(tok) {
  if (!tok || !tok.includes(".")) return false;
  const [b64, sig] = tok.split(".");
  let payload;
  try { payload = Buffer.from(b64, "base64url").toString(); } catch { return false; }
  const exp = Number(payload);
  if (!exp || Date.now() > exp) return false;
  const good = crypto.createHmac("sha256", ADMIN_SECRET).update(payload).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)); } catch { return false; }
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((c) => {
    const i = c.indexOf("="); if (i < 0) return;
    out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
const isAdmin = (req) => checkToken(parseCookies(req).admin_token);

/* ---------- HTTP utils ---------- */
function json(res, code, obj, headers = {}) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", ...headers });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => { d += c; if (d.length > 1e5) { reject(new Error("trop gros")); req.destroy(); } });
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });
}
async function readJSON(req) { try { return JSON.parse(await readBody(req)); } catch { return null; } }

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2",
};
function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  if (pathname === "/admin") pathname = "/admin.html";
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  const base = path.basename(filePath);
  if (base === ".env" || filePath.startsWith(DATA_DIR)) { res.writeHead(404); return res.end("Not found"); }
  readFile(filePath)
    .then((buf) => { res.writeHead(200, { "content-type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" }); res.end(buf); })
    .catch(() => { res.writeHead(404); res.end("Not found"); });
}

/* ---------- réservation (public) ---------- */
async function handleBook(req, res) {
  const p = await readJSON(req);
  if (!p) return json(res, 400, { ok: false, error: "json_invalide" });

  const service = String(p.service || "");
  const date = String(p.date || "");
  const time = String(p.time || "");
  const name = String(p.name || "").trim();
  const phone = String(p.phone || "").trim();

  if (!SERVICES[service]) return json(res, 400, { ok: false, error: "prestation_invalide" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { ok: false, error: "date_invalide" });
  if (name.length < 2) return json(res, 400, { ok: false, error: "nom_invalide" });
  if (phone.replace(/\D/g, "").length < 9) return json(res, 400, { ok: false, error: "tel_invalide" });
  if (new Date(date + "T00:00:00") < ymdToday()) return json(res, 400, { ok: false, error: "date_passee" });
  if (!dateIsOpen(date)) return json(res, 400, { ok: false, error: "jour_ferme" });
  if (!genSlotsForDow(dowOf(date)).includes(time)) return json(res, 400, { ok: false, error: "heure_invalide" });
  if (isTaken(date, time) || isBlocked(date, time)) return json(res, 409, { ok: false, error: "creneau_pris" });

  const svc = SERVICES[service];
  const booking = {
    id: `${date}-${time}-${crypto.randomBytes(3).toString("hex")}`,
    service, serviceLabel: svc.label, price: svc.price,
    date, dateLabel: fmtDateFR(date), time, name, phone,
    createdAt: new Date().toISOString(),
  };
  store.bookings.push(booking);
  saveJSON(BOOK_FILE, store);

  const [tg, mail] = await Promise.all([notifyTelegram(booking), notifyEmail(booking)]);
  console.log(`[résa] ${booking.dateLabel} ${time} — ${svc.label} — ${name} (${phone})  tg:${tg} mail:${mail}`);
  return json(res, 200, { ok: true, id: booking.id, notified: tg || mail });
}

/* ---------- admin ---------- */
function validateSettings(s) {
  const out = { step: 30, schedule: {}, closedDates: [], blockedSlots: {}, notifyEmail: "" };
  if ([15, 20, 30, 45, 60].includes(Number(s.step))) out.step = Number(s.step);

  if (!s.schedule || typeof s.schedule !== "object") return null;
  for (let d = 0; d < 7; d++) {
    const src = s.schedule[d] || s.schedule[String(d)];
    if (!src) { out.schedule[d] = newDay(false); continue; }
    const open = !!src.open;
    const ot = /^\d{2}:\d{2}$/.test(src.openTime) ? src.openTime : "11:00";
    const ct = /^\d{2}:\d{2}$/.test(src.closeTime) ? src.closeTime : "21:00";
    if (open && hhmmToMin(ct) <= hhmmToMin(ot)) return null; // horaires incohérents
    out.schedule[d] = newDay(open, ot, ct);
  }

  if (Array.isArray(s.closedDates)) out.closedDates = s.closedDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (s.blockedSlots && typeof s.blockedSlots === "object") {
    for (const [d, arr] of Object.entries(s.blockedSlots))
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Array.isArray(arr)) out.blockedSlots[d] = arr.filter((t) => /^\d{2}:\d{2}$/.test(t));
  }
  if (typeof s.notifyEmail === "string") {
    const e = s.notifyEmail.trim();
    if (e === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) out.notifyEmail = e;
    else return null; // adresse invalide
  }
  return out;
}

async function handleAdmin(req, res, pathname) {
  // login / logout n'exigent pas (encore) le cookie
  if (pathname === "/api/admin/login" && req.method === "POST") {
    const p = await readJSON(req);
    if (!ADMIN_PASSWORD) return json(res, 403, { ok: false, error: "admin_desactive" });
    if (!p || String(p.password).trim() !== ADMIN_PASSWORD.trim()) return json(res, 401, { ok: false, error: "mot_de_passe" });
    const cookie = `admin_token=${makeToken()}; HttpOnly; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax`;
    return json(res, 200, { ok: true }, { "set-cookie": cookie });
  }
  if (pathname === "/api/admin/logout" && req.method === "POST") {
    return json(res, 200, { ok: true }, { "set-cookie": "admin_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax" });
  }

  // tout le reste exige l'authentification
  if (!isAdmin(req)) return json(res, 401, { ok: false, error: "non_authentifie" });

  if (pathname === "/api/admin/state" && req.method === "GET") {
    const sorted = [...store.bookings].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return json(res, 200, { ok: true, settings, bookings: sorted, services: SERVICES, emailReady: !!EMAIL_API_KEY });
  }
  if (pathname === "/api/admin/settings" && req.method === "POST") {
    const p = await readJSON(req);
    const valid = p && validateSettings(p);
    if (!valid) return json(res, 400, { ok: false, error: "reglages_invalides" });
    settings = valid; saveJSON(SET_FILE, settings);
    return json(res, 200, { ok: true, settings });
  }
  if (pathname === "/api/admin/cancel" && req.method === "POST") {
    const p = await readJSON(req);
    const before = store.bookings.length;
    store.bookings = store.bookings.filter((b) => b.id !== (p && p.id));
    if (store.bookings.length === before) return json(res, 404, { ok: false, error: "introuvable" });
    saveJSON(BOOK_FILE, store);
    return json(res, 200, { ok: true });
  }
  if (pathname === "/api/admin/block" && req.method === "POST") {
    const p = await readJSON(req);
    if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !/^\d{2}:\d{2}$/.test(p.time))
      return json(res, 400, { ok: false, error: "param" });
    const list = (settings.blockedSlots[p.date] ||= []);
    const i = list.indexOf(p.time);
    if (p.blocked === false) { if (i >= 0) list.splice(i, 1); }
    else if (i < 0) list.push(p.time);
    if (list.length === 0) delete settings.blockedSlots[p.date];
    saveJSON(SET_FILE, settings);
    return json(res, 200, { ok: true, blockedSlots: settings.blockedSlots });
  }
  return json(res, 404, { ok: false, error: "route_inconnue" });
}

/* ---------- serveur ---------- */
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");

  if (pathname.startsWith("/api/")) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      return res.end();
    }
    try {
      if (pathname === "/api/config" && req.method === "GET") {
        return json(res, 200, {
          ok: true,
          config: {
            schedule: settings.schedule, step: settings.step, closedDates: settings.closedDates,
          },
          unavailable: unavailableMap(),
        });
      }
      if (pathname === "/api/book" && req.method === "POST") return await handleBook(req, res);
      if (pathname.startsWith("/api/admin/")) return await handleAdmin(req, res, pathname);
      return json(res, 404, { ok: false, error: "route_inconnue" });
    } catch (e) {
      console.error("[serveur]", e);
      return json(res, 500, { ok: false, error: "serveur" });
    }
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  JOHAN · serveur → http://localhost:${PORT}   (admin: /admin)`);
  console.log(`  Réservations : ${store.bookings.length} | Jours ouverts : ${Object.values(settings.schedule).filter((d) => d.open).length}/7 | Créneau : ${settings.step} min`);
  console.log(`  Telegram: ${TG_TOKEN && TG_CHAT ? "✓" : "✗"}  ·  E-mail: ${EMAIL_API_KEY && EMAIL_TO ? "✓" : "✗"}  ·  Admin: ${ADMIN_PASSWORD ? "✓" : "✗ (ADMIN_PASSWORD manquant)"}\n`);
});
