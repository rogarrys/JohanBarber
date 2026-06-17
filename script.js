/* ============================================================
   JOHAN · Barbier — Logique du site & réservation
   ============================================================ */

/* -------------------------------------------------------------
   CONFIG  —  ⚠️ À PERSONNALISER
   Remplace la valeur de "instagram" par le vrai pseudo (sans @).
   ------------------------------------------------------------- */
const CONFIG = {
  name: "Johan",
  instagram: "johanduviv", // pseudo Instagram (sans @)
  address: "9 allée François Vayva",
  hours: "11h – 21h",
};

const SERVICES = {
  "coupe":       { label: "Coupe",          price: 15, minutes: 45 },
  "coupe-barbe": { label: "Coupe + Barbe",  price: 20, minutes: 45 },
};

const DAYS_SHOWN = 14;       // nb de jours d'ouverture proposés
const DAYS_SCAN = 30;        // on balaye jusqu'à 30 jours pour trouver les jours ouverts
const STORAGE_KEY = "johan_rdv_v1";

/* Réglages : valeurs par défaut, écrasées par /api/config (panel admin).
   schedule[0..6] (0=dimanche) = { open, openTime, closeTime } */
const defDay = () => ({ open: true, openTime: "11:00", closeTime: "21:00" });
let cfg = {
  step: 30,
  schedule: { 0: defDay(), 1: defDay(), 2: defDay(), 3: defDay(), 4: defDay(), 5: defDay(), 6: defDay() },
  closedDates: [],
  unavailable: {},
};

/* ---------- petits utilitaires ---------- */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
const pad2 = (n) => String(n).padStart(2, "0");
const hhmmToMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const minutesToHHMM = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dayCfg = (dow) => (cfg.schedule && (cfg.schedule[dow] || cfg.schedule[String(dow)])) || { open: false, openTime: "11:00", closeTime: "21:00" };
function slotsForDate(dateKey) {
  const dc = dayCfg(new Date(dateKey + "T00:00:00").getDay());
  if (!dc.open) return [];
  const out = [], open = hhmmToMin(dc.openTime), close = hhmmToMin(dc.closeTime);
  for (let m = open; m <= close; m += cfg.step) out.push(minutesToHHMM(m)); // dernier créneau = heure de fermeture
  return out;
}
const dayIsOpen = (d) => dayCfg(d.getDay()).open && !cfg.closedDates.includes(ymd(d));

const fmtDow   = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const fmtMon   = new Intl.DateTimeFormat("fr-FR", { month: "short" });
const fmtFull  = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

/* ---------- état de la réservation ---------- */
const state = { service: null, date: null, time: null };

/* ============================================================
   1. ANNÉE + LIENS INSTAGRAM
   ============================================================ */
function initStatic() {
  const yearEl = $("#year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const profileURL = `https://instagram.com/${CONFIG.instagram}`;
  const dmURL = `https://ig.me/m/${CONFIG.instagram}`;
  const handle = `@${CONFIG.instagram}`;

  const contactIg = $("#contact-ig");
  if (contactIg) contactIg.href = dmURL;
  const contactHandle = $("#contact-ig-handle");
  if (contactHandle) contactHandle.textContent = handle;

  const mobileIg = $("#mobile-ig");
  if (mobileIg) { mobileIg.href = profileURL; mobileIg.textContent = handle; }

  const successIg = $("#success-ig");
  if (successIg) successIg.href = dmURL;
}

/* ============================================================
   2. NAV — état au scroll + menu mobile
   ============================================================ */
function initNav() {
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 24);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const burger = $("#burger");
  const menu = $("#mobile-menu");

  const closeMenu = () => {
    document.body.classList.remove("menu-open");
    burger.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };
  const openMenu = () => {
    document.body.classList.add("menu-open");
    burger.setAttribute("aria-expanded", "true");
    menu.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  };

  burger.addEventListener("click", () => {
    document.body.classList.contains("menu-open") ? closeMenu() : openMenu();
  });
  $$(".mobile-menu a").forEach((a) => a.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("menu-open")) closeMenu();
  });
}

/* ============================================================
   2bis. RÉALISATIONS — grille statique (lecture des vidéos)
   ============================================================ */
function initShowcase() {
  const grid = $("#showcase-grid");
  if (!grid) return;
  const cards = $$(".showcase__card", grid);

  // grille statique : on lance simplement les vidéos (muettes, en boucle)
  const play = () => cards.forEach((c) => { const v = c.querySelector("video"); if (v) v.play().catch(() => {}); });
  play();
  document.addEventListener("visibilitychange", () => {
    cards.forEach((c) => { const v = c.querySelector("video"); if (!v) return; document.hidden ? v.pause() : play(); });
  });
}

/* ============================================================
   3. REVEAL au scroll (IntersectionObserver)
   ============================================================ */
function initReveal() {
  const els = $$(".reveal");
  if (!("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("is-in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );
  els.forEach((el) => io.observe(el));
}

/* ============================================================
   4. CRÉNEAUX PRIS — serveur (partagé) + repli localStorage
   ============================================================ */
// Récupère les horaires + créneaux indisponibles auprès du serveur.
async function fetchConfig() {
  try {
    const res = await fetch("/api/config", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.ok) {
      if (data.config) {
        if (data.config.schedule) cfg.schedule = data.config.schedule;
        if (data.config.step) cfg.step = data.config.step;
        cfg.closedDates = Array.isArray(data.config.closedDates) ? data.config.closedDates : [];
      }
      cfg.unavailable = data.unavailable || {};
    }
  } catch {
    /* serveur indisponible : on garde les valeurs par défaut + repli localStorage */
  }
}

function getLocalBookings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function isBooked(date, time) {
  if (Array.isArray(cfg.unavailable[date]) && cfg.unavailable[date].includes(time)) return true;
  const b = getLocalBookings();
  return Array.isArray(b[date]) && b[date].includes(time);
}
function addBooking(date, time) {
  (cfg.unavailable[date] ||= []).push(time);
  const b = getLocalBookings();
  if (!b[date]) b[date] = [];
  if (!b[date].includes(time)) b[date].push(time);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(b)); } catch {}
}

/* ============================================================
   5. CONSTRUCTION DU FORMULAIRE DE RÉSERVATION
   ============================================================ */
function buildServiceChips() {
  const wrap = $("#service-options");
  wrap.innerHTML = "";
  Object.entries(SERVICES).forEach(([id, s]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.dataset.service = id;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", "false");
    btn.innerHTML = `<span class="chip__name">${s.label}</span>
      <span class="chip__meta"><b>${s.price}€</b> · ≈ ${s.minutes} min</span>`;
    btn.addEventListener("click", () => selectService(id));
    wrap.appendChild(btn);
  });
}

// Renvoie la liste des prochains jours OUVERTS (selon la config) — réutilisée à l'init.
function openDays() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey = ymd(today);
  const out = [];
  for (let i = 0; i < DAYS_SCAN && out.length < DAYS_SHOWN; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    if (dayIsOpen(d)) out.push({ d, key: ymd(d), isToday: ymd(d) === todayKey });
  }
  return out;
}

function buildDateStrip() {
  const wrap = $("#date-strip");
  wrap.innerHTML = "";
  const days = openDays();

  if (days.length === 0) {
    wrap.innerHTML = `<p class="slot-grid__empty">Aucune date disponible pour le moment.</p>`;
    return;
  }
  for (const { d, key, isToday } of days) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "date-cell";
    cell.dataset.date = key;
    cell.setAttribute("role", "radio");
    cell.setAttribute("aria-checked", "false");
    if (isToday) cell.classList.add("is-today");

    const dow = isToday ? "Auj." : fmtDow.format(d).replace(".", "");
    cell.innerHTML = `<span class="date-cell__dow">${dow}</span>
      <span class="date-cell__day">${d.getDate()}</span>
      <span class="date-cell__mon">${fmtMon.format(d).replace(".", "")}</span>`;
    cell.addEventListener("click", () => selectDate(key));
    wrap.appendChild(cell);
  }
}

function buildSlots() {
  const wrap = $("#slot-grid");
  wrap.innerHTML = "";

  if (!state.date) {
    wrap.innerHTML = `<p class="slot-grid__empty">Choisis d'abord un jour.</p>`;
    return;
  }

  const now = new Date();
  const isToday = state.date === ymd(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  let available = 0;
  for (const time of slotsForDate(state.date)) {
    const m = hhmmToMin(time);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot";
    btn.textContent = time;
    btn.dataset.time = time;
    btn.setAttribute("role", "radio");

    const past = isToday && m <= nowMinutes + 15; // marge de 15 min
    const taken = isBooked(state.date, time);

    if (past || taken) {
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
      btn.title = taken ? "Créneau déjà pris" : "Créneau passé";
    } else {
      available++;
      btn.setAttribute("aria-checked", "false");
      btn.addEventListener("click", () => selectTime(time));
    }
    wrap.appendChild(btn);
  }

  if (available === 0) {
    const note = document.createElement("p");
    note.className = "slot-grid__empty";
    note.textContent = "Plus de créneau ce jour-là. Essaie un autre jour.";
    wrap.appendChild(note);
  }
}

/* ---------- sélections ---------- */
function selectService(id) {
  state.service = id;
  $$("#service-options .chip").forEach((c) => {
    const on = c.dataset.service === id;
    c.classList.toggle("is-active", on);
    c.setAttribute("aria-checked", on ? "true" : "false");
  });
  updateSummary();
}

function selectDate(key) {
  state.date = key;
  state.time = null;
  $$("#date-strip .date-cell").forEach((c) => {
    const on = c.dataset.date === key;
    c.classList.toggle("is-active", on);
    c.setAttribute("aria-checked", on ? "true" : "false");
  });
  buildSlots();
  updateSummary();
}

function selectTime(time) {
  state.time = time;
  $$("#slot-grid .slot").forEach((s) => {
    const on = s.dataset.time === time && !s.disabled;
    s.classList.toggle("is-active", on);
    if (!s.disabled) s.setAttribute("aria-checked", on ? "true" : "false");
  });
  updateSummary();
}

/* ---------- récap live + activation du bouton ---------- */
function updateSummary() {
  const summary = $("#booking-summary");
  const submit = $("#booking-submit");

  if (!state.service) {
    summary.innerHTML = "Sélectionne une prestation pour commencer.";
    submit.disabled = true;
    return;
  }
  const s = SERVICES[state.service];
  let txt = `<b>${s.label}</b> <span class="price">${s.price}€</span>`;
  if (state.date) {
    const d = new Date(state.date + "T00:00:00");
    txt += ` · ${fmtFull.format(d)}`;
  }
  if (state.time) txt += ` à <b>${state.time}</b>`;

  if (!state.date)       txt += " — choisis un jour.";
  else if (!state.time)  txt += " — choisis une heure.";

  summary.innerHTML = txt;

  const name = $("#cust-name").value.trim();
  const phone = $("#cust-phone").value.trim();
  submit.disabled = !(state.service && state.date && state.time && name.length >= 2 && validPhone(phone));
}

function validPhone(v) {
  const digits = v.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15;
}

/* ============================================================
   6. CONFIRMATION
   ============================================================ */
async function handleSubmit() {
  const errorEl = $("#booking-error");
  const submit = $("#booking-submit");
  errorEl.textContent = "";

  const nameEl = $("#cust-name");
  const phoneEl = $("#cust-phone");
  const name = nameEl.value.trim();
  const phone = phoneEl.value.trim();

  nameEl.classList.toggle("is-error", name.length < 2);
  phoneEl.classList.toggle("is-error", !validPhone(phone));

  if (!state.service || !state.date || !state.time) {
    errorEl.textContent = "Choisis une prestation, un jour et une heure.";
    return;
  }
  if (name.length < 2) { errorEl.textContent = "Indique ton prénom."; nameEl.focus(); return; }
  if (!validPhone(phone)) { errorEl.textContent = "Indique un numéro de téléphone valide."; phoneEl.focus(); return; }

  if (isBooked(state.date, state.time)) {
    errorEl.textContent = "Ce créneau vient d'être pris, choisis-en un autre.";
    buildSlots(); state.time = null; updateSummary();
    return;
  }

  const s = SERVICES[state.service];
  const d = new Date(state.date + "T00:00:00");
  const dateLabel = fmtFull.format(d);

  // état "envoi en cours"
  const submitLabel = submit.textContent;
  submit.disabled = true;
  submit.textContent = "Envoi…";

  // 1) on tente le serveur (notifie Johan via Telegram + enregistre la résa)
  let viaServer = false;
  try {
    const res = await fetch("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: state.service, date: state.date, time: state.time, name, phone }),
    });
    if (res.status === 409) {
      await fetchConfig();
      buildSlots(); state.time = null; updateSummary();
      errorEl.textContent = "Ce créneau vient d'être pris, choisis-en un autre.";
      submit.textContent = submitLabel;
      return;
    }
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok) viaServer = true;
    else throw new Error("réponse serveur invalide");
  } catch {
    viaServer = false; // serveur indisponible → repli Instagram
  }

  addBooking(state.date, state.time);
  buildICS(s, d, dateLabel, name);

  if (viaServer) {
    showSuccess(s, dateLabel, true);
    showToast("Demande envoyée à Johan.");
  } else {
    const message =
      `Bonjour ${CONFIG.name},\n` +
      `Je souhaite réserver :\n` +
      `- ${s.label} (${s.price}€)\n` +
      `- ${dateLabel} à ${state.time}\n` +
      `- Prénom : ${name}\n` +
      `- Tél : ${phone}\n` +
      `Merci !`;
    copyToClipboard(message);
    showSuccess(s, dateLabel, false);
    showToast("Récap copié, colle-le dans ton DM Instagram.");
  }
  submit.textContent = submitLabel;
}

function showSuccess(s, dateLabel, viaServer) {
  $("#booking-form").hidden = true;
  const box = $("#booking-success");
  box.hidden = false;
  $("#success-recap").innerHTML =
    `<b>${s.label}</b> · ${s.price}€<br>${dateLabel} à <b>${state.time}</b>`;

  const ig = $("#success-ig");
  const note = $("#success-note");
  if (viaServer) {
    if (ig) ig.style.display = "none";
    if (note) note.textContent = "Ta demande est partie chez Johan, il te confirme rapidement.";
  } else {
    if (ig) ig.style.display = "";
    if (note) note.textContent = "Dernière étape : envoie-moi le récap sur Instagram pour que je valide. Le message est déjà copié.";
  }
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}

let icsURL = null;
function buildICS(s, dateObj, dateLabel, name) {
  const [h, m] = state.time.split(":").map(Number);
  const start = new Date(dateObj); start.setHours(h, m, 0, 0);
  const end = new Date(start.getTime() + s.minutes * 60000);

  const fmtICS = (dt) =>
    `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}T${pad2(dt.getHours())}${pad2(dt.getMinutes())}00`;

  const uid = `${state.date}-${state.time}-${Math.abs(hashStr(name))}@johan-barbier`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Johan Barbier//RDV//FR",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${fmtICS(new Date())}`,
    `DTSTART:${fmtICS(start)}`,
    `DTEND:${fmtICS(end)}`,
    `SUMMARY:${s.label} chez ${CONFIG.name}`,
    `LOCATION:${CONFIG.address}`,
    `DESCRIPTION:Rendez-vous ${s.label} (${s.price}€) au nom de ${name}.`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  if (icsURL) URL.revokeObjectURL(icsURL);
  icsURL = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
  return h;
}

function resetBooking() {
  state.service = null; state.time = null;
  $("#cust-name").value = ""; $("#cust-phone").value = "";
  $("#cust-name").classList.remove("is-error");
  $("#cust-phone").classList.remove("is-error");
  $("#booking-error").textContent = "";
  buildServiceChips();
  buildSlots();
  updateSummary();
  $("#booking-success").hidden = true;
  $("#booking-form").hidden = false;
  $("#reserver").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ============================================================
   7. CLIPBOARD + TOAST
   ============================================================ */
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand("copy"); } catch {}
  document.body.removeChild(ta);
}

let toastTimer = null;
function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-visible"), 4200);
}

/* ============================================================
   8. DÉCLENCHEURS "Réserver" (cartes prestations)
   ============================================================ */
function initBookTriggers() {
  $$(".book-trigger").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.service;
      if (id && SERVICES[id]) selectService(id);
      $("#reserver").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

/* ============================================================
   AFFICHAGE DES HORAIRES (public) — depuis la config par jour
   ============================================================ */
const DAY_FULL = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const fmtHeure = (t) => { const [h, m] = t.split(":"); return m === "00" ? `${parseInt(h, 10)}h` : `${parseInt(h, 10)}h${m}`; };

function renderHours() {
  const order = [1, 2, 3, 4, 5, 6, 0]; // Lundi → Dimanche
  const list = $("#hours-list");
  if (list) {
    list.innerHTML = order.map((d) => {
      const c = dayCfg(d);
      const val = c.open ? `${fmtHeure(c.openTime)} – ${fmtHeure(c.closeTime)}` : "Fermé";
      return `<div class="hours-row"><span>${DAY_FULL[d]}</span><span${c.open ? "" : ' class="is-closed"'}>${val}</span></div>`;
    }).join("");
  }
  // fourchette globale (pour le hero + footer)
  let minO = null, maxC = null;
  order.forEach((d) => {
    const c = dayCfg(d);
    if (!c.open) return;
    const o = hhmmToMin(c.openTime), cl = hhmmToMin(c.closeTime);
    if (minO === null || o < minO) minO = o;
    if (maxC === null || cl > maxC) maxC = cl;
  });
  const env = minO !== null ? `${fmtHeure(minutesToHHMM(minO))} – ${fmtHeure(minutesToHHMM(maxC))}` : "Sur RDV";
  const fact = $("#fact-hours"); if (fact) fact.textContent = env;
  const foot = $("#footer-hours"); if (foot) foot.textContent = env;
}

/* ============================================================
   RENDU (re)construit la partie réservation selon la config
   ============================================================ */
function renderBooking() {
  renderHours();
  buildDateStrip();
  const days = openDays();
  // garde la date choisie si elle est encore valide, sinon prend le 1er jour ouvert
  if (!state.date || !days.some((x) => x.key === state.date)) {
    state.date = days.length ? days[0].key : null;
  }
  $$("#date-strip .date-cell").forEach((c) => {
    const on = c.dataset.date === state.date;
    c.classList.toggle("is-active", on);
    c.setAttribute("aria-checked", on ? "true" : "false");
  });
  buildSlots();
  updateSummary();
}

/* ============================================================
   INIT
   ============================================================ */
function init() {
  initStatic();
  initNav();
  initReveal();
  initShowcase();

  buildServiceChips();
  initBookTriggers();

  // rendu initial (valeurs par défaut), puis rafraîchi avec la config du serveur
  renderBooking();
  fetchConfig().then(renderBooking);

  $("#cust-name").addEventListener("input", updateSummary);
  $("#cust-phone").addEventListener("input", updateSummary);
  $("#booking-submit").addEventListener("click", handleSubmit);
  $("#success-reset").addEventListener("click", resetBooking);
  $("#success-ics").addEventListener("click", () => {
    if (!icsURL) return;
    const a = document.createElement("a");
    a.href = icsURL;
    a.download = "rdv-johan.ics";
    document.body.appendChild(a); a.click(); a.remove();
    showToast("Rendez-vous ajouté au calendrier.");
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
