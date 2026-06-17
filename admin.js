/* ============================================================
   JOHAN · Panel admin — logique
   ============================================================ */
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

const DAYS = [
  { n: 1, l: "Lun" }, { n: 2, l: "Mar" }, { n: 3, l: "Mer" }, { n: 4, l: "Jeu" },
  { n: 5, l: "Ven" }, { n: 6, l: "Sam" }, { n: 0, l: "Dim" },
];

let data = { settings: null, bookings: [], services: {} };

const fmtShort = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const labelDate = (d) => fmtShort.format(new Date(d + "T00:00:00")).replace(/\./g, "");

const hhmmToMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const minToHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
function genSlots(s) {
  const out = [], o = hhmmToMin(s.openTime), c = hhmmToMin(s.closeTime);
  for (let m = o; m <= c - s.step; m += s.step) out.push(minToHHMM(m));
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
  $("#openTime").value = s.openTime;
  $("#closeTime").value = s.closeTime;
  $("#step").value = String(s.step);

  const daysWrap = $("#days"); daysWrap.innerHTML = "";
  DAYS.forEach((d) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "day-toggle" + (s.openDays.includes(d.n) ? " is-on" : "");
    b.textContent = d.l; b.dataset.day = d.n;
    b.onclick = () => b.classList.toggle("is-on");
    daysWrap.appendChild(b);
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

  // options d'heure pour bloquer
  const bt = $("#block-time"); bt.innerHTML = "";
  genSlots(s).forEach((t) => { const o = document.createElement("option"); o.value = t; o.textContent = t; bt.appendChild(o); });

  renderBookings();
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
  data.settings.openTime = $("#openTime").value;
  data.settings.closeTime = $("#closeTime").value;
  data.settings.step = Number($("#step").value);
  data.settings.openDays = $$(".day-toggle.is-on").map((b) => Number(b.dataset.day));
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

load();
