/* ============================================================
   JOHAN · Panel admin — logique
   ============================================================ */
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

const DAYS = [
  { n: 1, l: "Lundi" }, { n: 2, l: "Mardi" }, { n: 3, l: "Mercredi" }, { n: 4, l: "Jeudi" },
  { n: 5, l: "Vendredi" }, { n: 6, l: "Samedi" }, { n: 0, l: "Dimanche" },
];

let data = { settings: null, bookings: [], services: {} };

const fmtShort = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const labelDate = (d) => fmtShort.format(new Date(d + "T00:00:00")).replace(/\./g, "");

const hhmmToMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const minToHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const dayCfg = (dow) => (data.settings.schedule && (data.settings.schedule[dow] || data.settings.schedule[String(dow)])) || { open: false, openTime: "11:00", closeTime: "21:00" };
function genSlotsForDow(dow) {
  const c = dayCfg(dow);
  if (!c.open) return [];
  const out = [], o = hhmmToMin(c.openTime), cl = hhmmToMin(c.closeTime);
  for (let m = o; m <= cl; m += data.settings.step) out.push(minToHHMM(m)); // dernier créneau = heure de fermeture
  return out;
}

async function api(path, method = "GET", body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
  const res = await fetch(path, opt);
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

function show(view) {
  $("#login").hidden = view !== "login";
  $("#panel").hidden = view !== "panel";
}

let toastTimer = null;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("is-visible");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("is-visible"), 3000);
}

/* ---------- chargement + rendu ---------- */
async function load() {
  const { status, json } = await api("/api/admin/state");
  if (status === 401) { show("login"); return; }
  if (json && json.ok) {
    data = { settings: json.settings, bookings: json.bookings, services: json.services, emailReady: json.emailReady };
    show("panel"); render();
  } else { show("login"); }
}

function render() {
  const s = data.settings;
  $("#step").value = String(s.step);

  // planning par jour
  const sw = $("#schedule"); sw.innerHTML = "";
  DAYS.forEach((d) => {
    const c = s.schedule[d.n] || s.schedule[String(d.n)] || { open: false, openTime: "11:00", closeTime: "21:00" };
    const row = document.createElement("div");
    row.className = "sched-row" + (c.open ? "" : " is-closed");
    row.dataset.day = d.n;
    row.innerHTML =
      `<span class="sched-day">${d.l}</span>` +
      `<button type="button" class="sched-toggle${c.open ? " is-on" : ""}">${c.open ? "Ouvert" : "Fermé"}</button>` +
      `<span class="sched-times">` +
      `<input type="time" class="sched-open" step="900" value="${c.openTime}"${c.open ? "" : " disabled"} />` +
      `<span class="sched-sep">→</span>` +
      `<input type="time" class="sched-close" step="900" value="${c.closeTime}"${c.open ? "" : " disabled"} />` +
      `</span>`;
    row.querySelector(".sched-toggle").onclick = (e) => {
      const btn = e.currentTarget;
      const on = !btn.classList.contains("is-on");
      btn.classList.toggle("is-on", on);
      btn.textContent = on ? "Ouvert" : "Fermé";
      row.classList.toggle("is-closed", !on);
      row.querySelectorAll("input").forEach((i) => (i.disabled = !on));
    };
    sw.appendChild(row);
  });

  // congés
  const cl = $("#closed-list"); cl.innerHTML = "";
  s.closedDates.slice().sort().forEach((date) => {
    cl.appendChild(chip(labelDate(date), () => removeClosed(date)));
  });

  // créneaux bloqués (liste à plat)
  const blocked = [];
  Object.entries(s.blockedSlots || {}).forEach(([d, arr]) => arr.forEach((t) => blocked.push({ date: d, time: t })));
  blocked.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const bl = $("#blocked-list"); bl.innerHTML = "";
  blocked.forEach(({ date, time }) => bl.appendChild(chip(`${labelDate(date)} · ${time}`, () => toggleBlock(date, time, false))));

  updateBlockTimes();
  renderBookings();
}

// remplit les heures à bloquer selon la date choisie (ou toutes si aucune)
function updateBlockTimes() {
  const date = $("#block-date").value;
  const bt = $("#block-time"); bt.innerHTML = "";
  let times;
  if (date) {
    times = genSlotsForDow(new Date(date + "T00:00:00").getDay());
  } else {
    const set = new Set();
    DAYS.forEach((d) => genSlotsForDow(d.n).forEach((t) => set.add(t)));
    times = [...set].sort();
  }
  if (times.length === 0) {
    const o = document.createElement("option"); o.value = ""; o.textContent = "Jour fermé"; bt.appendChild(o);
  } else {
    times.forEach((t) => { const o = document.createElement("option"); o.value = t; o.textContent = t; bt.appendChild(o); });
  }
}

function chip(label, onRemove) {
  const li = document.createElement("li");
  li.className = "achip";
  li.innerHTML = `<span>${label}</span>`;
  const x = document.createElement("button");
  x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", "Retirer");
  x.onclick = onRemove;
  li.appendChild(x);
  return li;
}

function renderBookings() {
  const wrap = $("#bookings"); wrap.innerHTML = "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  $("#count").textContent = data.bookings.length ? `(${data.bookings.length})` : "";
  data.bookings.forEach((b) => {
    const past = new Date(b.date + "T00:00:00") < today;
    const row = document.createElement("div");
    row.className = "brow" + (past ? " is-past" : "");
    row.innerHTML =
      `<div class="brow__when"><b>${b.time}</b><br>${labelDate(b.date)}</div>` +
      `<div class="brow__who"><span class="name">${esc(b.name)}</span>` +
      `<span class="meta"><a href="tel:${esc(b.phone)}">${esc(b.phone)}</a></span>` +
      `<span class="brow__svc">${esc(b.serviceLabel)} · ${b.price}€</span></div>`;
    const btn = document.createElement("button");
    btn.className = "brow__cancel"; btn.textContent = "Annuler";
    btn.onclick = () => cancelBooking(b.id);
    row.appendChild(btn);
    wrap.appendChild(row);
  });
}

/* ---------- actions ---------- */
async function postSettings(silent) {
  const { json } = await api("/api/admin/settings", "POST", data.settings);
  if (json && json.ok) { data.settings = json.settings; render(); return true; }
  if (!silent) {
    const msg = $("#settings-msg");
    msg.textContent = json && json.error === "reglages_invalides" ? "Vérifie l'ouverture / fermeture." : "Erreur d'enregistrement.";
    msg.classList.remove("is-ok");
  }
  return false;
}

async function saveSettings() {
  data.settings.step = Number($("#step").value);
  const schedule = {};
  $$("#schedule .sched-row").forEach((row) => {
    const d = row.dataset.day;
    schedule[d] = {
      open: row.querySelector(".sched-toggle").classList.contains("is-on"),
      openTime: row.querySelector(".sched-open").value || "11:00",
      closeTime: row.querySelector(".sched-close").value || "21:00",
    };
  });
  data.settings.schedule = schedule;
  const ok = await postSettings(false);
  if (ok) {
    const msg = $("#settings-msg");
    msg.textContent = "Enregistré ✓"; msg.classList.add("is-ok");
    setTimeout(() => { msg.textContent = ""; msg.classList.remove("is-ok"); }, 2500);
    toast("Horaires mis à jour");
  }
}

async function addClosed() {
  const v = $("#closed-date").value;
  if (!v) return;
  if (!data.settings.closedDates.includes(v)) data.settings.closedDates.push(v);
  if (await postSettings(false)) toast("Jour de congé ajouté");
}
async function removeClosed(date) {
  data.settings.closedDates = data.settings.closedDates.filter((d) => d !== date);
  if (await postSettings(false)) toast("Congé retiré");
}

async function toggleBlock(date, time, blocked) {
  const { json } = await api("/api/admin/block", "POST", { date, time, blocked });
  if (json && json.ok) { data.settings.blockedSlots = json.blockedSlots; render(); toast(blocked ? "Créneau bloqué" : "Créneau débloqué"); }
}
function addBlock() {
  const date = $("#block-date").value, time = $("#block-time").value;
  if (!date || !time) { toast("Choisis une date et une heure"); return; }
  toggleBlock(date, time, true);
}

async function cancelBooking(id) {
  if (!confirm("Annuler ce rendez-vous ?")) return;
  const { json } = await api("/api/admin/cancel", "POST", { id });
  if (json && json.ok) { await load(); toast("Rendez-vous annulé"); }
}

/* ---------- évènements ---------- */
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#login-error"); err.textContent = "";
  const { status, json } = await api("/api/admin/login", "POST", { password: $("#password").value.trim() });
  if (json && json.ok) { $("#password").value = ""; load(); }
  else if (status === 403) err.textContent = "Espace admin non configuré (ADMIN_PASSWORD).";
  else err.textContent = "Mot de passe incorrect.";
});
$("#logout").addEventListener("click", async () => { await api("/api/admin/logout", "POST", {}); show("login"); });
$("#save-settings").addEventListener("click", saveSettings);
$("#add-closed").addEventListener("click", addClosed);
$("#add-block").addEventListener("click", addBlock);
$("#block-date").addEventListener("change", updateBlockTimes);

load();
