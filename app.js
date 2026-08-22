/* app.js — SPA légère, sans framework, 100% locale.
   Vues : Accueil / Agenda / Clients / Fiche client / Paramètres
   Toute la donnée passe par DB (db.js → IndexedDB). */

const APP_VERSION = "1.10.0"; // Bumper ce numéro (et CACHE_NAME dans sw.js) à chaque mise à jour livrée.

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const JOURS_COURT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const DOMICILE_ADRESSE = "41 avenue Maréchal Foch, 76290 Montivilliers";

const state = {
  view: "accueil",
  weekStart: startOfWeek(new Date()),
  clientId: null,
  clientSearch: "",
  agendaSearch: "",
};

// ---------- Utilitaires date ----------
function startOfDay(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}
function startOfWeek(d) {
  const date = startOfDay(d);
  const day = (date.getDay() + 6) % 7; // lundi = 0
  date.setDate(date.getDate() - day);
  return date;
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function isSameDay(a, b) { return toISO(a) === toISO(b); }
function toISO(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtShort(d) { return `${d.getDate()} ${MOIS_COURT[d.getMonth()]}`; }
function fmtDateFR(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MOIS_COURT[m - 1]} ${y}`;
}
function fmtDateTimeFR(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}
function periodLabel(p) { return p === "matin" ? "Matin" : p === "apres-midi" ? "Après-midi" : ""; }
function clientFullName(c) {
  if (!c) return "";
  return c.prenom ? `${c.prenom} ${c.nom}` : c.nom;
}
function clientInitials(c) {
  if (!c) return "?";
  const a = (c.prenom || c.nom || "?")[0] || "?";
  const b = c.prenom ? (c.nom || "?")[0] : (c.nom || "??")[1] || "?";
  return (a + b).toUpperCase();
}
function nouveauClientLabel(c) {
  if (!c) return "—";
  if (c.nouveauClient === "oui") return "Oui";
  if (c.nouveauClient === "non") return "Non";
  return "—";
}
function fmtDateFullFR(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${JOURS[(date.getDay() + 6) % 7]} ${d} ${MOIS[m - 1]} ${y}`;
}

// ---------- Rendu racine ----------
const root = document.getElementById("view-root");
const btnBack = document.getElementById("btn-back");

// ---------- Navigation / historique navigateur ----------
function historySnapshot() {
  return { view: state.view, clientId: state.clientId };
}
function navigate(view, clientId = null) {
  state.view = view;
  state.clientId = clientId;
  history.pushState(historySnapshot(), "", "#" + view);
  render();
}

let exitAllowed = false;
window.addEventListener("popstate", (e) => {
  if (!sheet.hidden) {
    closeSheet();
    history.pushState(historySnapshot(), "", location.hash || "#" + state.view);
    return;
  }
  if (state.view === "accueil" && !exitAllowed) {
    history.pushState(historySnapshot(), "", "#accueil");
    askExitConfirm();
    return;
  }
  exitAllowed = false;
  if (e.state) {
    state.view = e.state.view;
    state.clientId = e.state.clientId || null;
  } else {
    state.view = "accueil";
    state.clientId = null;
  }
  render();
});

function askExitConfirm() {
  openSheet(`
    <h2>Quitter l'application ?</h2>
    <p style="color:var(--smoke);font-size:14px;margin:-6px 0 4px;">Tu es sur l'écran d'accueil.</p>
    <div class="sheet-actions">
      <button class="btn-secondary" id="stay-btn">Rester</button>
      <button class="btn-danger" id="exit-btn">Quitter</button>
    </div>
  `);
  document.getElementById("stay-btn").onclick = () => closeSheet();
  document.getElementById("exit-btn").onclick = () => {
    closeSheet();
    exitAllowed = true;
    window.close();
    history.back();
  };
}

async function render() {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === state.view || (state.view === "fiche" && b.dataset.view === "clients"));
  });
  btnBack.hidden = state.view === "accueil";
  btnBack.onclick = () => history.back();

  if (state.view === "accueil") await renderAccueil();
  else if (state.view === "agenda") await renderAgenda();
  else if (state.view === "clients") await renderClients();
  else if (state.view === "fiche") await renderFiche();
  else if (state.view === "reglages") await renderReglages();

  root.scrollTop = 0;
}

// ---------- Vue Accueil ----------
async function renderAccueil() {
  const rdvs = await DB.listRendezvous();
  const todayISO = toISO(new Date());
  const upcoming = rdvs.filter((r) => r.date >= todayISO).length;

  root.innerHTML = `
    <p class="home-greeting">${upcoming > 0 ? `${upcoming} rendez-vous à venir` : "Aucun rendez-vous planifié pour l'instant"}</p>
    <div class="home-buttons">
      <button class="home-btn accent" data-nav="agenda">
        <span class="hb-icon"><svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zM5 9h14v11H5V9z"/></svg></span>
        <span class="hb-text">
          <span class="hb-title">Agenda</span>
          <span class="hb-sub">Voir les prochains rendez-vous</span>
        </span>
        <svg class="hb-chev" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="home-btn" data-nav="rdv-new">
        <span class="hb-icon"><svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg></span>
        <span class="hb-text">
          <span class="hb-title">Nouveau rendez-vous</span>
          <span class="hb-sub">Planifier une intervention</span>
        </span>
        <svg class="hb-chev" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="home-btn" data-nav="clients">
        <span class="hb-icon"><svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5z"/></svg></span>
        <span class="hb-text">
          <span class="hb-title">Clients</span>
          <span class="hb-sub">Rechercher une fiche</span>
        </span>
        <svg class="hb-chev" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="home-btn" data-nav="reglages">
        <span class="hb-icon"><svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.3 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.3-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6zM13 15.5A3.5 3.5 0 1 1 13 8.5a3.5 3.5 0 0 1 0 7z"/></svg></span>
        <span class="hb-text">
          <span class="hb-title">Paramètres</span>
          <span class="hb-sub">Version, sauvegarde, point de départ</span>
        </span>
        <svg class="hb-chev" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="home-btn" data-nav="recap-ets">
        <span class="hb-icon"><svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M4 4h16v12H7l-3 3V4zm2 3h12v2H6V7zm0 4h8v2H6v-2z"/></svg></span>
        <span class="hb-text">
          <span class="hb-title">Récapitulatif ETS Gallay</span>
          <span class="hb-sub">Envoyer le résumé de la semaine</span>
        </span>
        <svg class="hb-chev" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  `;

  root.querySelector('[data-nav="agenda"]').onclick = () => navigate("agenda");
  root.querySelector('[data-nav="clients"]').onclick = () => navigate("clients");
  root.querySelector('[data-nav="reglages"]').onclick = () => navigate("reglages");
  root.querySelector('[data-nav="rdv-new"]').onclick = () => openRdvForm();
  root.querySelector('[data-nav="recap-ets"]').onclick = () => openRecapEtsGallay();
}

// ---------- Récapitulatif ETS Gallay (facturation) ----------
const ETS_GALLAY_EMAIL = "etsgallay@gmail.com";

async function buildRecapData(startISO, endISO) {
  const rdvs = (await DB.listRendezvous())
    .filter((r) => r.statut === "honore" && r.date >= startISO && r.date <= endISO)
    .sort((a, b) => a.date.localeCompare(b.date));
  const clients = await DB.listClients();
  const cmap = Object.fromEntries(clients.map((c) => [c.id, c]));

  const nouveaux = [];
  const habituels = [];
  for (const r of rdvs) {
    const c = cmap[r.clientId];
    const entry = {
      nom: c ? clientFullName(c) : "Client supprimé",
      adresse: (c && c.adresse) || r.adresse || "",
      modele: (c && c.modele) || "",
      compteRendu: r.compteRenduHonore || "",
    };
    if (c && c.nouveauClient === "oui") nouveaux.push(entry);
    else habituels.push(entry);
  }
  return { nouveaux, habituels };
}

function formatRecapEntry(e) {
  let line = e.nom;
  if (e.adresse) line += ` — ${e.adresse}`;
  if (e.modele) line += ` — Modèle : ${e.modele}`;
  line += e.compteRendu ? ` — ${e.compteRendu}` : " — ⚠️ compte-rendu non renseigné";
  return line;
}

function currentRecapRange() {
  const today = new Date();
  const monday = startOfWeek(today);
  const friday = addDays(monday, 4);
  const todayISO = toISO(today);
  const fridayISO = toISO(friday);
  const endISO = todayISO <= fridayISO ? todayISO : fridayISO;
  return { startISO: toISO(monday), endISO };
}

async function openRecapEtsGallay() {
  const { startISO, endISO } = currentRecapRange();
  const { nouveaux, habituels } = await buildRecapData(startISO, endISO);

  if (nouveaux.length === 0 && habituels.length === 0) {
    toast("Aucun rendez-vous honoré sur cette période pour l'instant");
    return;
  }

  let body = `Bonjour,\n\nVoici le récapitulatif des interventions honorées du ${fmtDateFullFR(startISO)} au ${fmtDateFullFR(endISO)}.\n\n`;
  if (nouveaux.length) {
    body += "Nouveaux clients :\n" + nouveaux.map((e) => `- ${formatRecapEntry(e)}`).join("\n") + "\n\n";
  }
  if (habituels.length) {
    body += "Clients habituels :\n" + habituels.map((e) => `- ${formatRecapEntry(e)}`).join("\n") + "\n\n";
  }
  body += "Merci,";

  const subject = `Récapitulatif interventions — semaine du ${fmtDateFR(startISO)} au ${fmtDateFR(endISO)}`;
  window.location.href = `mailto:${ETS_GALLAY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function maybeFridayReminder() {
  const today = new Date();
  if (today.getDay() !== 5) return; // 5 = vendredi
  const todayISO = toISO(today);
  const lastShown = await DB.getParam("lastFridayReminderDate", null);
  if (lastShown === todayISO) return;
  await DB.setParam("lastFridayReminderDate", todayISO);
  toast("N'oublie pas d'envoyer le récapitulatif ETS Gallay aujourd'hui !");
}

// ---------- Vue Agenda (colonnes semaine, façon Google Agenda) ----------
async function renderAgenda() {
  root.innerHTML = `
    <input type="text" class="search-bar" id="agenda-search" placeholder="Rechercher un client dans l'agenda…" value="${escapeHtml(state.agendaSearch)}" />
    <div id="agenda-body"></div>
  `;
  const input = document.getElementById("agenda-search");
  input.oninput = () => { state.agendaSearch = input.value; refreshAgendaBody(); };
  await refreshAgendaBody();
}

async function refreshAgendaBody() {
  const container = document.getElementById("agenda-body");
  if (!container) return;

  if (state.agendaSearch.trim()) {
    container.innerHTML = await renderAgendaSearchHtml(state.agendaSearch.trim());
    container.querySelectorAll("[data-goto-date]").forEach((el) => {
      el.onclick = () => {
        state.weekStart = startOfWeek(new Date(el.dataset.gotoDate));
        state.agendaSearch = "";
        const input = document.getElementById("agenda-search");
        if (input) input.value = "";
        refreshAgendaBody();
      };
    });
    return;
  }

  const days = Array.from({ length: 5 }, (_, i) => addDays(state.weekStart, i));
  const startISO = toISO(days[0]), endISO = toISO(days[6]);
  const weekRdvs = await DB.listRendezvousRange(startISO, endISO);
  const byDate = {};
  weekRdvs.forEach((r) => { (byDate[r.date] ||= []).push(r); });

  const clients = await DB.listClients();
  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));
  const today = new Date();

  let html = `
    <div class="week-nav">
      <button id="week-prev" aria-label="Semaine précédente">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6"/></svg>
      </button>
      <button id="week-today" class="week-label">${fmtShort(days[0])} – ${fmtShort(days[6])}</button>
      <button id="week-next" aria-label="Semaine suivante">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>
      </button>
      <span class="week-jump-wrap">
        <button id="week-jump-btn" class="week-jump-btn" aria-label="Aller à une date">
          <svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zM5 9h14v11H5V9z"/></svg>
        </button>
        <input type="date" id="week-jump-input" class="week-jump-input" value="${toISO(days[0])}" />
      </span>
    </div>
    <div class="week-grid">
  `;

  for (const d of days) {
    const iso = toISO(d);
    const isToday = isSameDay(d, today);
    const items = (byDate[iso] || []).slice().sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
    const pendingCount = items.filter((r) => r.statut !== "honore").length;
    const calEvents = await getCalendarEventsForDate(iso);

    html += `<div class="day-col ${isToday ? "is-today" : ""}">
      <div class="day-col-head">
        <div class="dow">${JOURS_COURT[(d.getDay() + 6) % 7]}</div>
        <div class="dnum">${d.getDate()}</div>
      </div>
      ${calEvents.map((ev) => `<div class="cal-chip">📅 ${ev.time ? escapeHtml(ev.time) + " · " : ""}${escapeHtml(ev.title)}</div>`).join("")}
      ${pendingCount >= 2 ? `<button class="day-col-optimize" data-optimize="${iso}">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 2c1 3-1 4-1 6 0 1.2 1 2 2 2 1.3 0 2-1 2-2.2 1.6 1.4 3 3.7 3 6.2a6 6 0 0 1-12 0c0-2.6 1.1-4.3 2.3-6C9.2 6.3 10.5 4.4 12 2Z"/></svg>
        Optimiser
      </button>` : ""}
      ${items.length === 0
        ? `<button class="day-col-add" data-add="${iso}">+</button>`
        : items.map((r) => renderRdvChip(r, clientMap)).join("")}
    </div>`;
  }

  html += `</div>`;
  container.innerHTML = html;

  document.getElementById("week-prev").onclick = () => { state.weekStart = addDays(state.weekStart, -7); refreshAgendaBody(); };
  document.getElementById("week-next").onclick = () => { state.weekStart = addDays(state.weekStart, 7); refreshAgendaBody(); };
  document.getElementById("week-today").onclick = () => { state.weekStart = startOfWeek(new Date()); refreshAgendaBody(); };
  const jumpInput = document.getElementById("week-jump-input");
  document.getElementById("week-jump-btn").onclick = () => { jumpInput.showPicker ? jumpInput.showPicker() : jumpInput.focus(); };
  jumpInput.onchange = () => {
    if (!jumpInput.value) return;
    state.weekStart = startOfWeek(new Date(jumpInput.value));
    refreshAgendaBody();
  };

  container.querySelectorAll("[data-rdv-chip]").forEach((el) => {
    el.onclick = () => openRdvDetail(el.dataset.rdvChip);
  });
  container.querySelectorAll("[data-optimize]").forEach((el) => {
    el.onclick = () => optimizeDay(el.dataset.optimize);
  });
  container.querySelectorAll("[data-add]").forEach((el) => {
    el.onclick = () => openRdvForm({ date: el.dataset.add });
  });
}

function renderRdvChip(r, clientMap) {
  const c = clientMap[r.clientId];
  const name = c ? clientFullName(c) : "Client supprimé";
  const addr = c ? c.adresse : (r.adresse || "");
  const honore = r.statut === "honore";
  const typeClass = honore ? "is-honore" : (r.type === "entretien" ? "type-entretien" : "type-depannage");
  const period = periodLabel(r.periode);
  return `<button class="rdv-chip ${typeClass}" data-rdv-chip="${r.id}">
    ${honore ? '<span class="chip-period">✓ Honoré</span>' : (period ? `<span class="chip-period">${period}</span>` : "")}
    <span class="chip-name">${escapeHtml(name)}</span>
    ${addr ? `<span class="chip-addr">📍 ${escapeHtml(addr)}</span>` : ""}
  </button>`;
}

async function renderAgendaSearchHtml(query) {
  const todayISO = toISO(new Date());
  const q = query.toLowerCase();
  const all = (await DB.listRendezvous()).filter((r) => r.date >= todayISO);
  const clients = await DB.listClients();
  const cmap = Object.fromEntries(clients.map((c) => [c.id, c]));

  const matches = all
    .map((r) => ({ r, c: cmap[r.clientId] }))
    .filter((x) => x.c && clientFullName(x.c).toLowerCase().includes(q))
    .sort((a, b) => a.r.date.localeCompare(b.r.date));

  if (matches.length === 0) {
    return `<div class="empty-state"><span class="emoji">🔍</span>Aucun rendez-vous à venir pour ce client.</div>`;
  }
  return matches.map(({ r, c }) => `
    <button class="near-item-block" data-goto-date="${r.date}">
      <span class="nib-date">${fmtDateFR(r.date)}</span>
      <span class="nib-name">${escapeHtml(clientFullName(c))}</span>
      <span class="nib-addr">📍 ${escapeHtml(c.adresse || "")}</span>
    </button>
  `).join("");
}

// ---------- Optimisation de trajet ----------
async function getDomicileCoords() {
  const cached = await DB.getParam("domicileCoords", null);
  if (cached && cached.lat != null) return cached;
  const coords = await geocodeAddress(DOMICILE_ADRESSE);
  if (coords) await DB.setParam("domicileCoords", coords);
  return coords;
}

function getCurrentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

async function optimizeDay(dateISO) {
  openSheet(`
    <h2>Point de départ</h2>
    <p style="color:var(--smoke);font-size:13px;margin:-6px 0 14px;">D'où pars-tu pour cette tournée ?</p>
    <button class="choice-tile" id="opt-domicile">
      <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 3l9 8h-3v9h-5v-6H11v6H6v-9H3z"/></svg>
      <span>Domicile<span class="sub">${DOMICILE_ADRESSE}</span></span>
    </button>
    <button class="choice-tile" id="opt-gps">
      <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2a1 1 0 0 1 1 1v1.06A8 8 0 0 1 20 12a1 1 0 1 1 0 2 8 8 0 0 1-7 6.94V22a1 1 0 1 1-2 0v-1.06A8 8 0 0 1 4 14a1 1 0 1 1 0-2 8 8 0 0 1 7-6.94V3a1 1 0 0 1 1-1zm0 5.5A4.5 4.5 0 1 0 12 16a4.5 4.5 0 0 0 0-8.5zm0 2.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>
      <span>Ma position actuelle<span class="sub">Géolocaliser le téléphone maintenant</span></span>
    </button>
    <button class="choice-tile" id="opt-none">
      <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5z"/></svg>
      <span>Sans point de départ<span class="sub">Commencer par le client le plus proche</span></span>
    </button>
  `);

  document.getElementById("opt-domicile").onclick = async () => {
    closeSheet();
    toast("Localisation du domicile…");
    const coords = await getDomicileCoords();
    if (!coords) { toast("Géocodage du domicile impossible (hors ligne ?)"); return; }
    openOrderConstraintsSheet(dateISO, coords);
  };
  document.getElementById("opt-gps").onclick = async () => {
    closeSheet();
    toast("Localisation en cours…");
    const coords = await getCurrentPosition();
    if (!coords) { toast("Localisation indisponible"); return; }
    openOrderConstraintsSheet(dateISO, coords);
  };
  document.getElementById("opt-none").onclick = () => { closeSheet(); openOrderConstraintsSheet(dateISO, null); };
}

async function openOrderConstraintsSheet(dateISO, depart) {
  const rdvs = (await DB.listRendezvous()).filter((r) => r.date === dateISO && r.statut !== "honore");
  const clients = await DB.listClients();
  const cmap = Object.fromEntries(clients.map((c) => [c.id, c]));
  const options = rdvs.map((r) => ({ id: r.id, name: clientFullName(cmap[r.clientId]) || "Client" }));
  const optionsHtml = options.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join("");

  openSheet(`
    <h2>Ordre de la tournée</h2>
    <p style="color:var(--smoke);font-size:13px;margin:-6px 0 14px;">Facultatif : impose un client en premier et/ou en dernier — le reste sera optimisé automatiquement.</p>
    <div class="form-row">
      <label>Premier client</label>
      <select id="f-force-first" style="width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;background:var(--surface);color:var(--ink);">
        <option value="">Aucun (laisser optimiser)</option>
        ${optionsHtml}
      </select>
    </div>
    <div class="form-row">
      <label>Dernier client</label>
      <select id="f-force-last" style="width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;background:var(--surface);color:var(--ink);">
        <option value="">Aucun (laisser optimiser)</option>
        ${optionsHtml}
      </select>
    </div>
    <div class="sheet-actions">
      <button class="btn-secondary" id="cancel-btn">Annuler</button>
      <button class="btn-primary" id="go-btn">Calculer</button>
    </div>
  `);
  document.getElementById("cancel-btn").onclick = closeSheet;
  document.getElementById("go-btn").onclick = () => {
    const forceFirst = document.getElementById("f-force-first").value || null;
    const forceLast = document.getElementById("f-force-last").value || null;
    if (forceFirst && forceFirst === forceLast) { toast("Choisis deux clients différents pour le premier et le dernier"); return; }
    closeSheet();
    runOptimize(dateISO, depart, forceFirst, forceLast);
  };
}

async function runOptimize(dateISO, depart, forceFirstId, forceLastId) {
  const rdvs = (await DB.listRendezvous()).filter((r) => r.date === dateISO && r.statut !== "honore");
  const clients = await DB.listClients();
  const cmap = Object.fromEntries(clients.map((c) => [c.id, c]));

  const points = [];
  let missing = 0;
  for (const r of rdvs) {
    const c = cmap[r.clientId];
    if (c && c.lat != null) points.push({ id: r.id, lat: c.lat, lon: c.lon, name: clientFullName(c) });
    else missing++;
  }
  if (points.length < 2) {
    toast("Il faut au moins 2 clients géocodés ce jour-là");
    return;
  }

  const roundtrip = !!(await DB.getParam("retourDepart", false));

  toast("Calcul de l'itinéraire…");
  const result = await optimizeTripConstrained(points, depart, roundtrip, forceFirstId, forceLastId);

  for (const rdvId of result.order) {
    const r = rdvs.find((x) => x.id === rdvId);
    if (r) r.ordre = result.order.indexOf(rdvId);
  }
  for (const r of rdvs) if (r.ordre != null && points.some((p) => p.id === r.id)) await DB.saveRendezvous(r);

  const names = result.order.map((id) => points.find((p) => p.id === id)?.name).filter(Boolean);
  const steps = depart ? ["Départ", ...names] : names;

  openSheet(`
    <h2>Trajet optimisé</h2>
    ${missing > 0 ? `<p style="color:var(--smoke);font-size:12.5px;margin:-8px 0 12px;">${missing} client(s) non géocodé(s) ignoré(s) — ordre non garanti pour eux.</p>` : ""}
    ${result.estimated ? `<p style="color:var(--ember);font-size:12.5px;margin:-4px 0 12px;">⚠️ Calcul routier indisponible — estimation à vol d'oiseau.</p>` : ""}
    <div class="near-list">
      ${steps.map((n, i) => `<div class="near-item"><span>${i + 1}. ${escapeHtml(n)}</span></div>`).join("")}
    </div>
    <div class="info-row" style="margin-top:10px;"><span class="k">Distance totale</span><span class="v">${result.distanceKm.toFixed(1)} km</span></div>
    ${result.durationMin != null ? `<div class="info-row"><span class="k">Durée estimée</span><span class="v">${Math.round(result.durationMin)} min</span></div>` : ""}
    <div class="sheet-actions"><button class="btn-primary" id="ok-btn" style="width:100%;">OK</button></div>
  `);
  document.getElementById("ok-btn").onclick = () => { closeSheet(); refreshAgendaBody(); };
}

// ---------- Vue Clients ----------
async function renderClients() {
  const clients = await DB.searchClients(state.clientSearch);
  let html = `<h2 class="view-heading">Clients</h2><input type="text" class="search-bar" id="client-search" placeholder="Rechercher un client (nom, adresse, téléphone)" value="${escapeHtml(state.clientSearch)}" />`;

  if (clients.length === 0) {
    html += `<div class="empty-state"><span class="emoji">🔍</span>${state.clientSearch ? "Aucun client trouvé." : "Aucun client pour l'instant.<br>Ajoute ton premier client avec le bouton +."}</div>`;
  } else {
    html += clients.map((c) => clientRowHtml(c)).join("");
  }

  root.innerHTML = html;
  const input = document.getElementById("client-search");
  input.oninput = () => { state.clientSearch = input.value; renderClientsListOnly(); };
  root.querySelectorAll("[data-client]").forEach((el) => {
    el.onclick = () => navigate("fiche", el.dataset.client);
  });
}

function clientRowHtml(c) {
  return `<button class="client-row" data-client="${c.id}">
    <span class="client-avatar">${initials(c)}</span>
    <span>
      <span class="cname">${escapeHtml(clientFullName(c))} ${c.lat != null ? '<span class="geo-dot" title="Adresse géocodée"></span>' : ""}</span>
      <span class="caddr">${escapeHtml(c.adresse || "Adresse non renseignée")}</span>
    </span>
    <span class="chevron">
      <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </span>
  </button>`;
}

async function renderClientsListOnly() {
  const clients = await DB.searchClients(state.clientSearch);
  const container = document.createElement("div");
  if (clients.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="emoji">🔍</span>${state.clientSearch ? "Aucun client trouvé." : "Aucun client pour l'instant."}</div>`;
  } else {
    container.innerHTML = clients.map((c) => clientRowHtml(c)).join("");
  }
  root.querySelectorAll(".client-row, .empty-state").forEach((n) => n.remove());
  root.append(...container.childNodes);
  root.querySelectorAll("[data-client]").forEach((el) => {
    el.onclick = () => navigate("fiche", el.dataset.client);
  });
}

function initials(c) { return clientInitials(c); }

// ---------- Fiche client ----------
async function renderFiche() {
  const c = await DB.getClient(state.clientId);
  if (!c) { state.view = "clients"; return render(); }

  const historique = await DB.listInterventionsForClient(c.id);
  const todayISO = toISO(new Date());
  const upcomingRdv = (await DB.listRendezvous()).filter((r) => r.clientId === c.id && r.date >= todayISO).sort((a, b) => a.date.localeCompare(b.date));

  const wazeUrl = c.adresse ? `https://waze.com/ul?q=${encodeURIComponent(c.adresse)}&navigate=yes` : null;
  const telHref = c.telephone ? `tel:${c.telephone.replace(/\s+/g, "")}` : null;
  const smsBody = encodeURIComponent("Bonjour, ETS Gallay, je suis en route pour notre rendez-vous. À tout de suite.");
  const smsHref = c.telephone ? `sms:${c.telephone.replace(/\s+/g, "")}?body=${smsBody}` : null;

  root.innerHTML = `
    <div class="fiche-head">
      <p class="fname">${escapeHtml(clientFullName(c))}</p>
      <p class="faddr">${escapeHtml(c.adresse || "Adresse non renseignée")}</p>
      ${c.adresse ? (c.lat != null
        ? `<p class="geo-status geo-ok">📍 Adresse localisée <a href="https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}&zoom=17" target="_blank" rel="noopener" class="link-btn" style="text-decoration:underline;">Voir sur la carte</a></p>`
        : '<p class="geo-status geo-pending">⚠️ Adresse pas encore géocodée <button class="link-btn" id="retry-geo-btn">Réessayer</button></p>') : ""}
    </div>

    <div class="quick-actions">
      <a class="qa-btn" href="${wazeUrl || "#"}" ${wazeUrl ? "" : 'aria-disabled="true"'}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2C6.5 2 2 5.8 2 10.5c0 2.4 1.2 4.6 3.2 6.1-.2.9-.7 2-1.4 2.8-.2.2 0 .6.3.6 1.4-.1 3-.6 4-1.2 1.2.4 2.5.6 3.9.6 5.5 0 10-3.8 10-8.9S17.5 2 12 2z"/></svg>
        Waze
      </a>
      <a class="qa-btn" href="${telHref || "#"}" ${telHref ? "" : 'aria-disabled="true"'}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6.6 10.8c1.4 2.7 3.6 4.9 6.3 6.3l2.1-2.1c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1L6.6 10.8z"/></svg>
        Appeler
      </a>
      <a class="qa-btn" href="${smsHref || "#"}" ${smsHref ? "" : 'aria-disabled="true"'}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M4 4h16v12H7l-3 3V4z"/></svg>
        SMS
      </a>
      <button class="qa-btn" id="qa-rdv">
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zM5 9h14v11H5V9z"/></svg>
        RDV
      </button>
    </div>

    <div class="info-block">
      <h3>Installation</h3>
      <div class="info-row"><span class="k">Marque</span><span class="v">${escapeHtml(c.marque || "—")}</span></div>
      <div class="info-row"><span class="k">Modèle</span><span class="v">${escapeHtml(c.modele || "—")}</span></div>
      ${c.infosComplementaires ? `<div class="info-row"><span class="k">Infos</span><span class="v">${escapeHtml(c.infosComplementaires)}</span></div>` : ""}
    </div>

    <div class="info-block">
      <h3>Coordonnées</h3>
      <div class="info-row"><span class="k">Téléphone</span><span class="v">${escapeHtml(c.telephone || "—")}</span></div>
      ${c.email ? `<div class="info-row"><span class="k">E-mail</span><span class="v">${escapeHtml(c.email)}</span></div>` : ""}
      <div class="info-row"><span class="k">Nouveau client</span><span class="v">${nouveauClientLabel(c)}</span></div>
    </div>

    ${c.commentaires ? `<div class="info-block"><h3>Commentaires</h3><p class="comment-text">${escapeHtml(c.commentaires)}</p></div>` : ""}

    <div class="info-block">
      <h3>Rendez-vous à venir</h3>
      ${upcomingRdv.length === 0 ? '<p style="color:var(--smoke);font-size:13.5px;margin:4px 0;">Aucun rendez-vous planifié.</p>' :
        upcomingRdv.map((r) => `
          <button class="hist-item rdv-upcoming-item" data-rdv-upcoming="${r.id}" style="width:100%;text-align:left;background:none;border:none;color:inherit;">
            <div class="hist-top">
              <span class="hist-type ${r.type === "entretien" ? "type-entretien" : "type-depannage"}">${r.type === "entretien" ? "Entretien" : "Dépannage"}</span>
              <span class="hist-date">${fmtDateFR(r.date)}${periodLabel(r.periode) ? " · " + periodLabel(r.periode) : ""}</span>
            </div>
          </button>`).join("")}
    </div>

    <div class="info-block">
      <h3>Historique des interventions</h3>
      <div id="hist-list">
        ${historique.length === 0 ? '<p style="color:var(--smoke);font-size:13.5px;margin:4px 0;">Aucune intervention enregistrée.</p>' :
          historique.map((h) => `
            <div class="hist-item">
              <div class="hist-top">
                <span class="hist-type ${h.type === "entretien" ? "type-entretien" : "type-depannage"}">${h.type === "entretien" ? "Entretien" : "Dépannage"}</span>
                <span class="hist-date">${fmtDateFR(h.date)}</span>
              </div>
              ${h.description ? `<p class="hist-desc">${escapeHtml(h.description)}</p>` : ""}
              <div class="hist-actions">
                <button class="link-btn" data-edit-hist="${h.id}">Modifier</button>
                <button class="link-btn" data-del-hist="${h.id}">Supprimer</button>
              </div>
            </div>`).join("")}
      </div>
    </div>

    <div class="sheet-actions" style="margin-bottom:16px;">
      <button class="btn-secondary" id="edit-client-btn">Modifier la fiche</button>
      <button class="btn-danger" id="del-client-btn">Supprimer</button>
    </div>
  `;

  document.getElementById("qa-rdv").onclick = () => openRdvForm({ clientId: c.id });
  document.getElementById("edit-client-btn").onclick = () => openClientForm(c);
  document.getElementById("del-client-btn").onclick = () => confirmDeleteClient(c);

  const retryBtn = document.getElementById("retry-geo-btn");
  if (retryBtn) {
    retryBtn.onclick = async (e) => {
      e.preventDefault();
      toast("Nouvelle tentative de géocodage…");
      const coords = await geocodeAddress(c.adresse);
      const fresh = await DB.getClient(c.id);
      if (fresh) {
        if (coords) { fresh.lat = coords.lat; fresh.lon = coords.lon; fresh.geocodeStatus = "ok"; toast("Adresse localisée ✓"); }
        else { fresh.geocodeStatus = "pending"; toast("Toujours impossible à géocoder"); }
        await DB.saveClient(fresh);
      }
      render();
    };
  }

  root.querySelectorAll("[data-rdv-upcoming]").forEach((el) => {
    el.onclick = () => openRdvDetail(el.dataset.rdvUpcoming);
  });
  root.querySelectorAll("[data-edit-hist]").forEach((el) => {
    el.onclick = async () => {
      const item = historique.find((h) => h.id === el.dataset.editHist);
      openInterventionForm(c, item);
    };
  });
  root.querySelectorAll("[data-del-hist]").forEach((el) => {
    el.onclick = async () => {
      await DB.deleteIntervention(el.dataset.delHist);
      toast("Intervention supprimée");
      render();
    };
  });
}

// ---------- Paramètres ----------
async function renderReglages() {
  const retourDepart = await DB.getParam("retourDepart", false);
  const clientsSansGeo = (await DB.listClients()).filter((c) => c.adresse && c.lat == null).length;

  root.innerHTML = `
    <h2 class="view-heading">Paramètres</h2>

    <div class="info-block">
      <h3>À propos</h3>
      <div class="info-row"><span class="k">Version de l'application</span><span class="v">${APP_VERSION}</span></div>
    </div>

    <div class="info-block">
      <h3>Trajet</h3>
      <p style="font-size:13.5px;color:var(--smoke);margin:0 0 10px;">Le point de départ (Domicile ou position actuelle) se choisit à chaque optimisation, directement depuis l'agenda.</p>
      <div class="form-row" style="margin-bottom:0;">
        <label>En fin de tournée</label>
        <div class="pill-choice" id="f-retour">
          <button type="button" data-val="0" class="${!retourDepart ? "active period-active" : ""}">Terminer chez le dernier client</button>
          <button type="button" data-val="1" class="${retourDepart ? "active period-active" : ""}">Revenir au départ</button>
        </div>
      </div>
    </div>

    <div class="info-block">
      <h3>Géocodage</h3>
      <p style="font-size:13.5px;color:var(--smoke);margin:0 0 12px;">
        ${clientsSansGeo > 0 ? `${clientsSansGeo} adresse(s) client en attente de géocodage.` : "Toutes les adresses connues sont géocodées."}
      </p>
      <button class="btn-secondary" id="geocode-all-btn" style="width:100%;" ${clientsSansGeo === 0 ? "disabled" : ""}>Géocoder les adresses en attente</button>
    </div>

    <div class="info-block">
      <h3>Sauvegarde (Google Drive)</h3>
      <div id="drive-status"></div>
    </div>

    <div class="info-block">
      <h3>Google Agenda (lecture seule)</h3>
      <div id="calendar-status"></div>
    </div>
  `;

  document.querySelectorAll("#f-retour button").forEach((b) => {
    b.onclick = async () => {
      document.querySelectorAll("#f-retour button").forEach((x) => x.classList.remove("active", "period-active"));
      b.classList.add("active", "period-active");
      await DB.setParam("retourDepart", b.dataset.val === "1");
      toast("Paramètres enregistrés");
    };
  });

  document.getElementById("geocode-all-btn").onclick = async () => {
    const clients = (await DB.listClients()).filter((c) => c.adresse && c.lat == null);
    let done = 0;
    toast(`Géocodage en cours… (0/${clients.length})`);
    for (const c of clients) {
      const coords = await geocodeAddress(c.adresse);
      const fresh = await DB.getClient(c.id);
      if (fresh) {
        if (coords) { fresh.lat = coords.lat; fresh.lon = coords.lon; fresh.geocodeStatus = "ok"; }
        else { fresh.geocodeStatus = "pending"; }
        await DB.saveClient(fresh);
      }
      done++;
      toast(`Géocodage en cours… (${done}/${clients.length})`);
    }
    toast("Géocodage terminé ✓");
    if (state.view === "reglages") render();
  };

  await renderDriveStatus();
  await renderCalendarStatus();
}

async function buildBackupPayload() {
  return {
    clients: await DB.listClients(),
    rendezvous: await DB.listRendezvous(),
    interventions: (await Promise.all((await DB.listClients()).map((c) => DB.listInterventionsForClient(c.id)))).flat(),
    exportedAt: new Date().toISOString(),
  };
}

// ---------- Sauvegarde cloud (Google Drive) ----------
const CLOUD_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function runCloudBackup() {
  const data = await buildBackupPayload();
  try {
    await driveUploadBackup(JSON.stringify(data, null, 2));
    await DB.setParam("lastCloudBackupAt", new Date().toISOString());
    await DB.setParam("lastCloudError", null);
    driveCleanupOldBackups().catch(() => {}); // best-effort, ne doit jamais faire échouer la sauvegarde
    return { ok: true };
  } catch (e) {
    const msg = /interaction_required|access_denied|invalid_grant/.test(e.message)
      ? "Reconnexion nécessaire (accès expiré ou révoqué)"
      : (!navigator.onLine ? "Pas de connexion Internet" : e.message);
    await DB.setParam("lastCloudError", { message: msg, at: new Date().toISOString() });
    return { ok: false, error: msg };
  }
}

async function runCloudImport(fileId) {
  try {
    const text = await driveDownloadBackupById(fileId);
    const data = JSON.parse(text);
    for (const c of data.clients || []) await DB.saveClient(c);
    for (const r of data.rendezvous || []) await DB.saveRendezvous(r);
    for (const i of data.interventions || []) await DB.saveIntervention(i);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function fmtDriveBackupLabel(f) {
  // Le nom du fichier contient déjà la date/heure (ex: ...-2026-08-22_18h42.json) —
  // on s'en sert directement plutôt que de refaire confiance à createdTime (fuseau Drive).
  const m = f.name.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})h(\d{2})/);
  if (m) {
    const [, y, mo, d, h, mi] = m;
    return `${d} ${MOIS_COURT[parseInt(mo, 10) - 1]} ${y} à ${h}h${mi}`;
  }
  return f.createdTime ? fmtDateTimeFR(f.createdTime) : f.name;
}

async function maybeAutoCloudBackup() {
  const connected = await DB.getParam("driveConnected", false);
  if (!connected) return;
  const last = await DB.getParam("lastCloudBackupAt", null);
  if (last && Date.now() - new Date(last).getTime() < CLOUD_BACKUP_INTERVAL_MS) return;
  await runCloudBackup();
  if (state.view === "reglages") renderDriveStatus();
}

// ---------- Google Agenda (lecture seule) ----------
const CALENDAR_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CALENDAR_SYNC_HORIZON_DAYS = 90;

async function runCalendarSync() {
  try {
    const now = new Date();
    const future = addDays(now, CALENDAR_SYNC_HORIZON_DAYS);
    const events = await calendarFetchEvents(now.toISOString(), future.toISOString());
    const byDate = {};
    events.forEach((e) => { (byDate[e.date] ||= []).push({ time: e.time, title: e.title }); });
    await DB.setParam("calendarEventsCache", byDate);
    await DB.setParam("lastCalendarSyncAt", new Date().toISOString());
    await DB.setParam("lastCalendarError", null);
    return { ok: true };
  } catch (e) {
    const msg = /interaction_required|access_denied|invalid_grant/.test(e.message)
      ? "Reconnexion nécessaire (accès expiré ou révoqué)"
      : (!navigator.onLine ? "Pas de connexion Internet" : e.message);
    await DB.setParam("lastCalendarError", { message: msg, at: new Date().toISOString() });
    return { ok: false, error: msg };
  }
}

async function maybeAutoCalendarSync() {
  const connected = await DB.getParam("calendarConnected", false);
  if (!connected) return;
  const last = await DB.getParam("lastCalendarSyncAt", null);
  if (last && Date.now() - new Date(last).getTime() < CALENDAR_SYNC_INTERVAL_MS) return;
  await runCalendarSync();
  if (state.view === "reglages") renderCalendarStatus();
}

async function getCalendarEventsForDate(dateISO) {
  const cache = await DB.getParam("calendarEventsCache", {});
  return cache[dateISO] || [];
}

async function renderCalendarStatus() {
  const el = document.getElementById("calendar-status");
  if (!el) return;
  const connected = await DB.getParam("calendarConnected", false);
  const lastSync = await DB.getParam("lastCalendarSyncAt", null);
  const lastError = await DB.getParam("lastCalendarError", null);

  if (!connected) {
    el.innerHTML = `
      <p style="font-size:13.5px;color:var(--smoke);margin:0 0 12px;">Connecte le Google Agenda personnel de ton père (RDV médicaux, etc.) pour voir ses engagements directement dans l'agenda de l'appli et éviter les doubles réservations. Rien n'est jamais modifié sur son agenda — uniquement de la lecture.</p>
      <button class="btn-primary" id="cal-connect-btn" style="width:100%;">Connecter Google Agenda</button>
    `;
    document.getElementById("cal-connect-btn").onclick = async () => {
      try {
        toast("Connexion à Google…");
        await calendarConnect();
        await DB.setParam("calendarConnected", true);
        toast("Connecté ✓ — synchronisation en cours…");
        const r = await runCalendarSync();
        toast(r.ok ? "Synchronisation réussie ✓" : "Échec : " + r.error);
        renderCalendarStatus();
      } catch (e) {
        toast("Connexion impossible : " + e.message);
      }
    };
    return;
  }

  el.innerHTML = `
    <p class="geo-status geo-ok" style="margin:0 0 4px;">✓ Connecté à Google Agenda</p>
    <div class="info-row"><span class="k">Dernière synchronisation</span><span class="v">${lastSync ? fmtDateTimeFR(lastSync) : "Jamais"}</span></div>
    ${lastError ? `<p class="geo-status geo-pending" style="margin:6px 0 0;">⚠️ Dernier échec : ${escapeHtml(lastError.message)} (${fmtDateTimeFR(lastError.at)})</p>` : ""}
    <div class="sheet-actions" style="margin-top:10px;">
      <button class="btn-secondary" id="cal-sync-btn">Synchroniser maintenant</button>
    </div>
    <button class="btn-danger" id="cal-disconnect-btn" style="width:100%;margin-top:10px;">Déconnecter</button>
  `;
  document.getElementById("cal-sync-btn").onclick = async () => {
    toast("Synchronisation en cours…");
    const r = await runCalendarSync();
    toast(r.ok ? "Synchronisation réussie ✓" : "Échec : " + r.error);
    renderCalendarStatus();
  };
  document.getElementById("cal-disconnect-btn").onclick = async () => {
    calendarDisconnect();
    await DB.setParam("calendarConnected", false);
    toast("Déconnecté de Google Agenda");
    renderCalendarStatus();
  };
}

async function renderDriveStatus() {
  const el = document.getElementById("drive-status");
  if (!el) return;
  const connected = await DB.getParam("driveConnected", false);
  const lastBackup = await DB.getParam("lastCloudBackupAt", null);
  const lastError = await DB.getParam("lastCloudError", null);

  if (!connected) {
    el.innerHTML = `
      <p style="font-size:13.5px;color:var(--smoke);margin:0 0 12px;">Connecte un compte Google Drive dédié pour que tes données soient sauvegardées automatiquement chaque jour, à l'abri d'une casse ou d'un vol du téléphone.</p>
      <button class="btn-primary" id="drive-connect-btn" style="width:100%;">Connecter Google Drive</button>
    `;
    document.getElementById("drive-connect-btn").onclick = async () => {
      try {
        toast("Connexion à Google…");
        await driveConnect();
        await DB.setParam("driveConnected", true);
        toast("Connecté ✓ — première sauvegarde en cours…");
        const r = await runCloudBackup();
        toast(r.ok ? "Sauvegarde Drive réussie ✓" : "Échec de la sauvegarde : " + r.error);
        renderDriveStatus();
      } catch (e) {
        toast("Connexion impossible : " + e.message);
      }
    };
    return;
  }

  el.innerHTML = `
    <p class="geo-status geo-ok" style="margin:0 0 4px;">✓ Connecté à Google Drive</p>
    <div class="info-row"><span class="k">Dernière sauvegarde</span><span class="v">${lastBackup ? fmtDateTimeFR(lastBackup) : "Jamais"}</span></div>
    ${lastError ? `<p class="geo-status geo-pending" style="margin:6px 0 0;">⚠️ Dernier échec : ${escapeHtml(lastError.message)} (${fmtDateTimeFR(lastError.at)})</p>` : ""}
    <div class="sheet-actions" style="margin-top:10px;">
      <button class="btn-secondary" id="drive-backup-btn">Exporter vers Drive</button>
      <button class="btn-secondary" id="drive-import-btn">Importer depuis Drive</button>
    </div>
    <button class="btn-danger" id="drive-disconnect-btn" style="width:100%;margin-top:10px;">Déconnecter</button>
  `;
  document.getElementById("drive-backup-btn").onclick = async () => {
    toast("Sauvegarde en cours…");
    const r = await runCloudBackup();
    toast(r.ok ? "Sauvegarde Drive réussie ✓" : "Échec de la sauvegarde : " + r.error);
    renderDriveStatus();
  };
  document.getElementById("drive-import-btn").onclick = () => openBackupPicker();
  document.getElementById("drive-disconnect-btn").onclick = async () => {
    driveDisconnect();
    await DB.setParam("driveConnected", false);
    toast("Déconnecté de Google Drive");
    renderDriveStatus();
  };
}

async function openBackupPicker() {
  openSheet(`<h2>Choisir une sauvegarde</h2><p class="near-hint">Chargement des sauvegardes disponibles…</p>`);
  let files;
  try {
    files = await driveListBackups();
  } catch (e) {
    openSheet(`
      <h2>Erreur</h2>
      <p style="color:var(--smoke);font-size:14px;">${escapeHtml(e.message)}</p>
      <div class="sheet-actions"><button class="btn-primary" id="ok-btn" style="width:100%;">OK</button></div>
    `);
    document.getElementById("ok-btn").onclick = closeSheet;
    return;
  }
  if (files.length === 0) {
    openSheet(`
      <h2>Aucune sauvegarde trouvée</h2>
      <p style="color:var(--smoke);font-size:14px;">Aucune sauvegarde n'existe encore sur ce compte Drive.</p>
      <div class="sheet-actions"><button class="btn-primary" id="ok-btn" style="width:100%;">OK</button></div>
    `);
    document.getElementById("ok-btn").onclick = closeSheet;
    return;
  }
  openSheet(`
    <h2>Choisir une sauvegarde</h2>
    <p class="near-hint" style="margin:0 0 8px;">Sélectionne la date à restaurer.</p>
    <div class="near-list">
      ${files.map((f) => `<button type="button" class="near-item near-item-btn" data-file-id="${f.id}"><span>${fmtDriveBackupLabel(f)}</span></button>`).join("")}
    </div>
  `);
  document.querySelectorAll("[data-file-id]").forEach((el) => {
    el.onclick = () => confirmCloudImport(el.dataset.fileId, el.textContent.trim());
  });
}

async function confirmCloudImport(fileId, label) {
  openSheet(`
    <h2>Importer cette sauvegarde ?</h2>
    <p style="color:var(--smoke);font-size:14px;margin:-6px 0 4px;">${escapeHtml(label || "")}</p>
    <p style="color:var(--smoke);font-size:14px;">Cela va ajouter ou mettre à jour tes clients, rendez-vous et interventions locaux avec le contenu de cette sauvegarde. Rien ne sera supprimé localement.</p>
    <div class="sheet-actions">
      <button class="btn-secondary" id="cancel-btn">Annuler</button>
      <button class="btn-primary" id="confirm-btn">Importer</button>
    </div>
  `);
  document.getElementById("cancel-btn").onclick = closeSheet;
  document.getElementById("confirm-btn").onclick = async () => {
    closeSheet();
    toast("Import en cours…");
    const r = await runCloudImport(fileId);
    toast(r.ok ? "Import terminé ✓" : "Échec de l'import : " + r.error);
    render();
  };
}

// ---------- Sheet générique ----------
const sheetBackdrop = document.getElementById("sheet-backdrop");
const sheet = document.getElementById("sheet");
const sheetContent = document.getElementById("sheet-content");

function openSheet(html) {
  sheetContent.innerHTML = html;
  sheet.hidden = false;
  sheetBackdrop.hidden = false;
}
function closeSheet() {
  sheet.hidden = true;
  sheetBackdrop.hidden = true;
  sheetContent.innerHTML = "";
}
sheetBackdrop.onclick = closeSheet;

// ---------- FAB : choix rapide ----------
document.getElementById("fab-add").onclick = () => {
  openSheet(`
    <h2>Ajouter</h2>
    <button class="choice-tile" id="choice-client">
      <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5z"/></svg>
      <span>Nouveau client<span class="sub">Créer une fiche client</span></span>
    </button>
    <button class="choice-tile" id="choice-rdv">
      <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zM5 9h14v11H5V9z"/></svg>
      <span>Nouveau rendez-vous<span class="sub">Ajouter un RDV à l'agenda</span></span>
    </button>
    <button class="choice-tile" id="choice-intervention">
      <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M13.5 2.5l-9 9 3 3 9-9-3-3zM4 13l-1 4 4-1-3-3z"/></svg>
      <span>Nouvelle intervention<span class="sub">Ajouter à l'historique d'un client</span></span>
    </button>
  `);
  document.getElementById("choice-client").onclick = () => openClientForm();
  document.getElementById("choice-rdv").onclick = () => openRdvForm();
  document.getElementById("choice-intervention").onclick = () => openInterventionClientPicker();
};

// ---------- Formulaire client ----------
// onSaved(client) optionnel : si fourni, appelé après l'enregistrement à la place
// de la navigation par défaut vers la fiche (utilisé pour créer un client depuis
// le formulaire de rendez-vous, sans perdre le rendez-vous en cours de saisie).
async function openClientForm(existing, onSaved) {
  const c = existing || {};
  openSheet(`
    <h2>${existing ? "Modifier le client" : "Nouveau client"}</h2>
    <div class="form-row-2">
      <div class="form-row"><label>Nom</label><input type="text" id="f-nom" value="${escapeAttr(c.nom)}" /></div>
      <div class="form-row"><label>Prénom (facultatif)</label><input type="text" id="f-prenom" value="${escapeAttr(c.prenom)}" /></div>
    </div>
    <div class="form-row">
      <label>Nouveau client ?</label>
      <div class="pill-choice" id="f-civilite">
        <button type="button" data-val="" class="${!c.nouveauClient ? "active period-active" : ""}">Non précisé</button>
        <button type="button" data-val="oui" class="${c.nouveauClient === "oui" ? "active period-active" : ""}">Oui</button>
        <button type="button" data-val="non" class="${c.nouveauClient === "non" ? "active period-active" : ""}">Non</button>
      </div>
    </div>
    <div class="form-row"><label>Téléphone</label><input type="tel" id="f-tel" value="${escapeAttr(c.telephone)}" /></div>
    <div class="form-row"><label>E-mail (facultatif)</label><input type="email" id="f-email" value="${escapeAttr(c.email)}" /></div>
    <div class="form-row"><label>Adresse</label><input type="text" id="f-adresse" value="${escapeAttr(c.adresse)}" /></div>
    <div class="form-row-2">
      <div class="form-row"><label>Marque</label><input type="text" id="f-marque" value="${escapeAttr(c.marque)}" /></div>
      <div class="form-row"><label>Modèle</label><input type="text" id="f-modele" value="${escapeAttr(c.modele)}" /></div>
    </div>
    <div class="form-row"><label>Infos complémentaires</label><input type="text" id="f-infos" value="${escapeAttr(c.infosComplementaires)}" /></div>
    <div class="form-row"><label>Commentaires</label><textarea id="f-comment">${escapeHtml(c.commentaires || "")}</textarea></div>
    <div class="sheet-actions">
      <button class="btn-secondary" id="cancel-btn">Annuler</button>
      <button class="btn-primary" id="save-btn">Enregistrer</button>
    </div>
  `);

  document.getElementById("cancel-btn").onclick = closeSheet;
  let selCivilite = c.nouveauClient || "";
  document.querySelectorAll("#f-civilite button").forEach((b) => {
    b.onclick = () => {
      selCivilite = b.dataset.val;
      document.querySelectorAll("#f-civilite button").forEach((x) => x.classList.remove("active", "period-active"));
      b.classList.add("active", "period-active");
    };
  });
  document.getElementById("save-btn").onclick = async () => {
    const prenom = document.getElementById("f-prenom").value.trim();
    const nom = document.getElementById("f-nom").value.trim();
    if (!nom) { toast("Le nom est requis"); return; }
    const client = {
      ...c,
      prenom, nom,
      nouveauClient: selCivilite,
      telephone: document.getElementById("f-tel").value.trim(),
      email: document.getElementById("f-email").value.trim(),
      adresse: document.getElementById("f-adresse").value.trim(),
      marque: document.getElementById("f-marque").value.trim(),
      modele: document.getElementById("f-modele").value.trim(),
      infosComplementaires: document.getElementById("f-infos").value.trim(),
      commentaires: document.getElementById("f-comment").value.trim(),
    };
    const addressChanged = !existing || existing.adresse !== client.adresse;
    if (addressChanged) { client.lat = null; client.lon = null; client.geocodeStatus = null; }
    const saved = await DB.saveClient(client);
    closeSheet();

    if (onSaved) {
      onSaved(saved);
    } else {
      toast(existing ? "Client mis à jour" : "Client créé");
      navigate("fiche", saved.id);
    }

    // Géocodage en arrière-plan : ne bloque jamais l'enregistrement du client.
    if (client.adresse && (addressChanged || saved.lat == null)) {
      geocodeAddress(client.adresse).then(async (coords) => {
        const fresh = await DB.getClient(saved.id);
        if (!fresh) return;
        if (coords) { fresh.lat = coords.lat; fresh.lon = coords.lon; fresh.geocodeStatus = "ok"; }
        else { fresh.geocodeStatus = "pending"; }
        await DB.saveClient(fresh);
        if (state.view === "fiche" && state.clientId === saved.id) render();
      });
    }
  };
}

async function confirmDeleteClient(c) {
  openSheet(`
    <h2>Supprimer ${escapeHtml(clientFullName(c))} ?</h2>
    <p style="color:var(--smoke);font-size:14px;">Cette action supprimera aussi son historique d'interventions. Les rendez-vous déjà planifiés resteront dans l'agenda mais ne seront plus rattachés à un client.</p>
    <div class="sheet-actions">
      <button class="btn-secondary" id="cancel-btn">Annuler</button>
      <button class="btn-danger" id="confirm-btn">Supprimer</button>
    </div>
  `);
  document.getElementById("cancel-btn").onclick = closeSheet;
  document.getElementById("confirm-btn").onclick = async () => {
    const hist = await DB.listInterventionsForClient(c.id);
    for (const h of hist) await DB.deleteIntervention(h.id);
    await DB.deleteClient(c.id);
    closeSheet();
    toast("Client supprimé");
    navigate("clients");
  };
}

// ---------- Rendez-vous proches ----------
async function renderNearbyHtml(clientId, dateISO, excludeRdvId) {
  const wrap = (inner) => `
    <div class="info-block" style="margin-top:2px;">
      <h3>Rendez-vous proches</h3>
      ${inner}
    </div>
  `;

  if (!clientId) {
    return wrap('<p class="near-hint">Sélectionne ou crée un client pour voir automatiquement les rendez-vous déjà pris à proximité.</p>');
  }
  const client = await DB.getClient(clientId);
  if (!client) return wrap('<p class="near-hint">Sélectionne ou crée un client pour voir automatiquement les rendez-vous déjà pris à proximité.</p>');
  if (client.lat == null) {
    return wrap('<p class="near-hint">📍 Ce client n\'est pas encore géocodé — les rendez-vous proches ne peuvent pas être calculés (réessaie depuis sa fiche une fois en ligne).</p>');
  }
  const start = new Date(dateISO);
  const end = new Date(dateISO);
  end.setDate(end.getDate() + 90);
  const startISO = toISO(start), endISO = toISO(end);

  const all = await DB.listRendezvous();
  const clients = await DB.listClients();
  const cmap = Object.fromEntries(clients.map((c) => [c.id, c]));

  const candidates = all.filter((r) => r.id !== excludeRdvId && r.clientId !== clientId && r.date >= startISO && r.date <= endISO);
  const withDist = candidates
    .map((r) => {
      const rc = cmap[r.clientId];
      if (!rc || rc.lat == null) return null;
      return { date: r.date, name: clientFullName(rc), distKm: haversineKm(client.lat, client.lon, rc.lat, rc.lon) };
    })
    .filter((x) => x && x.distKm <= 15)
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, 5);

  if (withDist.length === 0) {
    return wrap('<p class="near-hint">Aucun rendez-vous trouvé à moins de 15 km dans les 90 prochains jours.</p>');
  }
  return wrap(`
    <p class="near-hint" style="margin:0 0 6px;">Dans un rayon de 15 km, sur les 90 prochains jours. Touche une date pour la reprendre pour ce rendez-vous.</p>
    <div class="near-list">
      ${withDist.map((x) => `<button type="button" class="near-item near-item-btn" data-copy-date="${x.date}"><span>${fmtDateFullFR(x.date)} — ${escapeHtml(x.name)}</span><span class="dist">${x.distKm.toFixed(1)} km</span></button>`).join("")}
    </div>
  `);
}

async function computeNearbyByPosition(coords, horizonDays) {
  const startISO = toISO(new Date());
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + horizonDays);
  const endISO = toISO(endDate);

  const all = (await DB.listRendezvous()).filter((r) => r.date >= startISO && r.date <= endISO && r.statut !== "honore");
  const clients = await DB.listClients();
  const cmap = Object.fromEntries(clients.map((c) => [c.id, c]));

  return all
    .map((r) => {
      const c = cmap[r.clientId];
      if (!c || c.lat == null) return null;
      return { date: r.date, name: clientFullName(c), distKm: haversineKm(coords.lat, coords.lon, c.lat, c.lon) };
    })
    .filter((x) => x && x.distKm <= 20)
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, 8);
}

// ---------- Formulaire rendez-vous ----------
async function openRdvForm(prefill = {}, existing) {
  const clients = await DB.listClients();
  const r = existing || {};
  let selectedClientId = r.clientId || prefill.clientId || null;
  const date = r.date || prefill.date || toISO(new Date());
  const periode = r.periode ?? prefill.periode ?? "";
  const type = r.type || prefill.type || "entretien";

  openSheet(`
    <h2>${existing ? "Modifier le rendez-vous" : "Nouveau rendez-vous"}</h2>
    <div class="form-row">
      <label>Client</label>
      <div class="pill-choice" id="f-client-mode">
        <button type="button" data-val="existing" class="active period-active">Client existant</button>
        <button type="button" data-val="new">Nouveau client</button>
      </div>
    </div>
    <div id="client-existing-block">
      <div class="form-row">
        <div id="f-client-selected" class="client-picker-selected"></div>
        <input type="text" id="f-client-search" placeholder="Rechercher un client…" />
        <div id="f-client-results" class="client-picker-results"></div>
      </div>
    </div>
    <div id="client-new-block" hidden>
      <button type="button" class="choice-tile" id="f-client-new-btn" style="margin-top:0;">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>
        <span>Créer un nouveau client<span class="sub">Ouvre la fiche complète, puis reprend ce rendez-vous</span></span>
      </button>
    </div>
    <div class="form-row"><label>Date</label><input type="date" id="f-date" value="${date}" /></div>
    <div id="calendar-warning"></div>
    <div class="form-row">
      <label>Moment souhaité par le client (facultatif)</label>
      <div class="pill-choice pill-3" id="f-periode">
        <button type="button" data-val="" class="${periode === "" ? "active period-active" : ""}">Non précisé</button>
        <button type="button" data-val="matin" class="${periode === "matin" ? "active period-active" : ""}">Matin</button>
        <button type="button" data-val="apres-midi" class="${periode === "apres-midi" ? "active period-active" : ""}">Après-midi</button>
      </div>
    </div>
    <div class="form-row">
      <label>Type d'intervention</label>
      <div class="pill-choice" id="f-type">
        <button type="button" data-val="entretien" class="${type === "entretien" ? "active type-entretien" : ""}">Entretien</button>
        <button type="button" data-val="depannage" class="${type === "depannage" ? "active type-depannage" : ""}">Dépannage</button>
      </div>
    </div>
    <div class="form-row"><label>Commentaire (facultatif)</label><textarea id="f-comment">${escapeHtml(r.commentaire || "")}</textarea></div>
    <div id="near-container"></div>
    <div class="info-block" style="margin-top:2px;">
      <h3>Proposer une date selon le secteur</h3>
      <p class="near-hint" style="margin:0 0 8px;">Utile au téléphone : indique la ville ou l'adresse dite par l'appelant pour voir si d'autres clients y ont déjà rendez-vous.</p>
      <input type="text" id="f-sector-input" placeholder="Ville ou adresse (ex : Étretat)" style="width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;background:var(--surface);color:var(--ink);margin-bottom:8px;" />
      <div class="pill-choice pill-3" id="geo-near-buttons">
        <button type="button" data-days="30">30 jours</button>
        <button type="button" data-days="90">90 jours</button>
        <button type="button" data-days="365">12 mois</button>
      </div>
      <div id="geo-near-results"></div>
    </div>
    <div class="sheet-actions">
      <button class="btn-secondary" id="cancel-btn">Annuler</button>
      <button class="btn-primary" id="save-btn">Enregistrer</button>
    </div>
    ${existing ? `<button class="btn-danger" id="del-btn" style="width:100%;margin-top:10px;">Supprimer le rendez-vous</button>` : ""}
  `);

  document.querySelectorAll("#f-client-mode button").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll("#f-client-mode button").forEach((x) => x.classList.remove("active", "period-active"));
      b.classList.add("active", "period-active");
      const mode = b.dataset.val;
      document.getElementById("client-existing-block").hidden = mode !== "existing";
      document.getElementById("client-new-block").hidden = mode !== "new";
    };
  });

  const selectedEl = document.getElementById("f-client-selected");
  const searchInput = document.getElementById("f-client-search");
  const resultsEl = document.getElementById("f-client-results");

  function updateSelectedDisplay() {
    const c = clients.find((x) => x.id === selectedClientId);
    selectedEl.innerHTML = c ? `<div class="client-picker-chip">${escapeHtml(clientFullName(c))}</div>` : `<div class="near-hint">Aucun client sélectionné</div>`;
  }
  updateSelectedDisplay();

  searchInput.oninput = () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) { resultsEl.innerHTML = ""; return; }
    const matches = clients.filter((c) => clientFullName(c).toLowerCase().includes(q)).slice(0, 6);
    resultsEl.innerHTML = matches.length
      ? matches.map((c) => `<button type="button" class="client-picker-item" data-cid="${c.id}">${escapeHtml(clientFullName(c))}</button>`).join("")
      : `<p class="near-hint">Aucun client trouvé.</p>`;
    resultsEl.querySelectorAll("[data-cid]").forEach((btn) => {
      btn.onclick = () => {
        selectedClientId = btn.dataset.cid;
        updateSelectedDisplay();
        searchInput.value = "";
        resultsEl.innerHTML = "";
        refreshNearby();
      };
    });
  };

  document.getElementById("f-client-new-btn").onclick = () => {
    const stash = {
      date: document.getElementById("f-date").value,
      periode: selPeriode,
      type: selType,
      commentaire: document.getElementById("f-comment").value,
    };
    openClientForm(null, (newClient) => {
      openRdvForm({ ...stash, clientId: newClient.id }, existing);
    });
  };

  const nearContainer = document.getElementById("near-container");
  async function refreshNearby() {
    const dateVal = document.getElementById("f-date").value;
    nearContainer.innerHTML = await renderNearbyHtml(selectedClientId, dateVal, existing ? existing.id : null);
    nearContainer.querySelectorAll("[data-copy-date]").forEach((el) => {
      el.onclick = () => {
        document.getElementById("f-date").value = el.dataset.copyDate;
        refreshNearby();
      };
    });
  }
  async function refreshCalendarWarning() {
    const el = document.getElementById("calendar-warning");
    if (!el) return;
    const dateVal = document.getElementById("f-date").value;
    const events = await getCalendarEventsForDate(dateVal);
    el.innerHTML = events.length
      ? `<p class="geo-status geo-pending" style="margin:4px 0 8px;">⚠️ Google Agenda ce jour-là : ${events.map((e) => `${e.time ? escapeHtml(e.time) + " " : ""}${escapeHtml(e.title)}`).join(", ")}</p>`
      : "";
  }
  document.getElementById("f-date").onchange = () => { refreshNearby(); refreshCalendarWarning(); };
  refreshNearby();
  refreshCalendarWarning();

  let sectorCoords = null;
  const sectorInput = document.getElementById("f-sector-input");
  sectorInput.oninput = () => { sectorCoords = null; };

  document.querySelectorAll("#geo-near-buttons button").forEach((b) => {
    b.onclick = async () => {
      let coords = sectorCoords;
      if (!coords) {
        const addr = sectorInput.value.trim();
        if (!addr) { toast("Indique d'abord une ville ou une adresse"); return; }
        toast("Recherche de l'adresse…");
        coords = await geocodeAddress(addr);
        if (!coords) { toast("Adresse introuvable (vérifie l'orthographe ou la connexion)"); return; }
        sectorCoords = coords;
      }
      const days = parseInt(b.dataset.days, 10);
      const results = await computeNearbyByPosition(coords, days);
      const resultsEl = document.getElementById("geo-near-results");
      resultsEl.innerHTML = results.length
        ? `<div class="near-list">${results.map((x) => `<button type="button" class="near-item near-item-btn" data-copy-date-geo="${x.date}"><span>${fmtDateFullFR(x.date)} — ${escapeHtml(x.name)}</span><span class="dist">${x.distKm.toFixed(1)} km</span></button>`).join("")}</div>`
        : `<p class="near-hint">Aucun rendez-vous trouvé à proximité sur cette période.</p>`;
      resultsEl.querySelectorAll("[data-copy-date-geo]").forEach((el) => {
        el.onclick = () => {
          document.getElementById("f-date").value = el.dataset.copyDateGeo;
          refreshNearby();
        };
      });
    };
  });

  let selPeriode = periode, selType = type;
  document.querySelectorAll("#f-periode button").forEach((b) => {
    b.onclick = () => { selPeriode = b.dataset.val; document.querySelectorAll("#f-periode button").forEach((x) => x.classList.remove("active", "period-active")); b.classList.add("active", "period-active"); };
  });
  document.querySelectorAll("#f-type button").forEach((b) => {
    b.onclick = () => {
      selType = b.dataset.val;
      document.querySelectorAll("#f-type button").forEach((x) => x.classList.remove("active", "type-entretien", "type-depannage"));
      b.classList.add("active", b.dataset.val === "entretien" ? "type-entretien" : "type-depannage");
    };
  });

  document.getElementById("cancel-btn").onclick = closeSheet;
  document.getElementById("save-btn").onclick = async () => {
    if (!selectedClientId) { toast("Sélectionne ou crée un client"); return; }
    const client = clients.find((c) => c.id === selectedClientId) || await DB.getClient(selectedClientId);
    if (!client) { toast("Client introuvable"); return; }
    const item = {
      ...r,
      clientId: client.id,
      date: document.getElementById("f-date").value,
      periode: selPeriode,
      type: selType,
      adresse: client.adresse,
      commentaire: document.getElementById("f-comment").value.trim(),
      ordre: r.ordre ?? Date.now(),
    };
    await DB.saveRendezvous(item);
    closeSheet();
    if (existing) {
      toast("Rendez-vous mis à jour");
      navigate("agenda");
    } else {
      openRdvConfirmSheet(item, client);
    }
  };
  if (existing) {
    document.getElementById("del-btn").onclick = async () => {
      await DB.deleteRendezvous(existing.id);
      closeSheet();
      toast("Rendez-vous supprimé");
      render();
    };
  }
}

async function openRdvConfirmSheet(item, client) {
  const addr = item.adresse || client.adresse || "";
  const smsBody = encodeURIComponent(
    `Bonjour, suite à votre appel je vous confirme la prise d'un rendez-vous pour un ${item.type === "entretien" ? "entretien" : "dépannage"}${addr ? " à l'adresse " + addr : ""} le ${fmtDateFullFR(item.date)}, bonne journée !`
  );
  const smsHref = client.telephone ? `sms:${client.telephone.replace(/\s+/g, "")}?body=${smsBody}` : null;

  openSheet(`
    <h2>Rendez-vous créé ✓</h2>
    <p style="color:var(--smoke);font-size:14px;margin:-6px 0 16px;">${escapeHtml(clientFullName(client))} — ${fmtDateFullFR(item.date)}</p>
    ${smsHref ? `<a class="btn-secondary" href="${smsHref}" style="display:block;text-align:center;text-decoration:none;padding:13px;border-radius:12px;margin-bottom:10px;">Récapitulatif par SMS</a>`
      : '<p class="near-hint" style="margin-bottom:10px;">Aucun téléphone enregistré pour ce client — pas de SMS possible.</p>'}
    <button class="btn-primary" id="done-btn" style="width:100%;">Terminer</button>
  `);
  document.getElementById("done-btn").onclick = () => { closeSheet(); navigate("agenda"); };
}

// ---------- Détail rendez-vous (RDV honoré / modifier / supprimer) ----------
async function openRdvDetail(id) {
  const r = await DB.getRendezvous(id);
  if (!r) return;
  const client = await DB.getClient(r.clientId);
  const addr = (client && client.adresse) || r.adresse || "";
  const mapsUrl = addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;
  const wazeUrl = addr ? `https://waze.com/ul?q=${encodeURIComponent(addr)}&navigate=yes` : null;
  const telHref = client && client.telephone ? `tel:${client.telephone.replace(/\s+/g, "")}` : null;
  const smsBody = client ? encodeURIComponent("Bonjour, ETS Gallay, je suis en route pour notre rendez-vous. À tout de suite.") : "";
  const smsHref = client && client.telephone ? `sms:${client.telephone.replace(/\s+/g, "")}?body=${smsBody}` : null;
  const period = periodLabel(r.periode);

  openSheet(`
    <h2>${client ? escapeHtml(clientFullName(client)) : "Rendez-vous"}</h2>
    <p style="color:var(--smoke);font-size:13px;margin:-10px 0 4px;">${fmtDateFR(r.date)}${period ? " · " + period : ""} · ${r.type === "entretien" ? "Entretien" : "Dépannage"}${r.statut === "honore" ? " · <span style=\"color:var(--moss);font-weight:600;\">✓ Honoré</span>" : ""}</p>
    ${addr ? `<p style="font-size:13.5px;color:var(--ink-dim);margin:0 0 4px;">📍 ${escapeHtml(addr)}</p>` : ""}
    ${r.statut === "honore" && r.compteRenduHonore ? `<p style="font-size:13.5px;color:var(--ink-dim);margin:0 0 4px;">📝 ${escapeHtml(r.compteRenduHonore)}</p>` : (r.commentaire ? `<p style="font-size:13.5px;color:var(--ink-dim);margin:0 0 4px;">${escapeHtml(r.commentaire)}</p>` : "")}

    <div class="quick-actions">
      <a class="qa-btn" href="${wazeUrl || "#"}" ${wazeUrl ? "" : 'aria-disabled="true"'}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2C6.5 2 2 5.8 2 10.5c0 2.4 1.2 4.6 3.2 6.1-.2.9-.7 2-1.4 2.8-.2.2 0 .6.3.6 1.4-.1 3-.6 4-1.2 1.2.4 2.5.6 3.9.6 5.5 0 10-3.8 10-8.9S17.5 2 12 2z"/></svg>
        Waze
      </a>
      <a class="qa-btn" href="${mapsUrl || "#"}" target="_blank" rel="noopener" ${mapsUrl ? "" : 'aria-disabled="true"'}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>
        Maps
      </a>
      <a class="qa-btn" href="${telHref || "#"}" ${telHref ? "" : 'aria-disabled="true"'}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6.6 10.8c1.4 2.7 3.6 4.9 6.3 6.3l2.1-2.1c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1L6.6 10.8z"/></svg>
        Appeler
      </a>
      <a class="qa-btn" href="${smsHref || "#"}" ${smsHref ? "" : 'aria-disabled="true"'}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M4 4h16v12H7l-3 3V4z"/></svg>
        SMS
      </a>
    </div>

    ${r.statut === "honore" ? "" : '<button class="btn-primary" id="honore-btn" style="width:100%;margin-bottom:10px;">✓ RDV honoré</button>'}
    <div class="sheet-actions">
      <button class="btn-secondary" id="edit-btn">Modifier</button>
      <button class="btn-danger" id="del-btn">Supprimer</button>
    </div>
  `);

  document.getElementById("edit-btn").onclick = () => openRdvForm({}, r);
  document.getElementById("del-btn").onclick = async () => {
    await DB.deleteRendezvous(r.id);
    closeSheet();
    toast("Rendez-vous supprimé");
    render();
  };
  const honoreBtn = document.getElementById("honore-btn");
  if (honoreBtn) honoreBtn.onclick = () => openHonoreForm(r, client);
}

async function openHonoreForm(r, client) {
  openSheet(`
    <h2>RDV honoré</h2>
    <p style="color:var(--smoke);font-size:13px;margin:-8px 0 14px;">${client ? escapeHtml(clientFullName(client)) : ""} — ${fmtDateFR(r.date)}</p>
    <p style="font-size:13.5px;color:var(--ink-dim);margin:0 0 14px;">Ce rendez-vous sera ajouté à l'historique du client, avec un compte-rendu si tu le souhaites.</p>
    <div class="form-row"><label>Compte-rendu (facultatif)</label><textarea id="f-compte-rendu" placeholder="Ex : nettoyage complet, RAS...">${escapeHtml(r.commentaire || "")}</textarea></div>
    <div class="sheet-actions">
      <button class="btn-secondary" id="cancel-btn">Annuler</button>
      <button class="btn-primary" id="confirm-btn">Valider</button>
    </div>
  `);
  document.getElementById("cancel-btn").onclick = closeSheet;
  document.getElementById("confirm-btn").onclick = async () => {
    await DB.saveIntervention({
      clientId: r.clientId,
      date: r.date,
      type: r.type,
      description: document.getElementById("f-compte-rendu").value.trim(),
    });
    r.statut = "honore";
    r.compteRenduHonore = document.getElementById("f-compte-rendu").value.trim();
    await DB.saveRendezvous(r);
    closeSheet();
    toast("Rendez-vous honoré, ajouté à l'historique");
    navigate("agenda");
  };
}

// ---------- Formulaire intervention ----------
async function openInterventionClientPicker() {
  const clients = await DB.listClients();
  if (clients.length === 0) { toast("Ajoute d'abord un client"); return openClientForm(); }
  openSheet(`
    <h2>Pour quel client ?</h2>
    <div class="form-row">
      <select id="f-client-pick" style="width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;background:var(--surface);color:var(--ink);">
        ${clients.map((c) => `<option value="${c.id}">${escapeHtml(clientFullName(c))}</option>`).join("")}
      </select>
    </div>
    <div class="sheet-actions">
      <button class="btn-secondary" id="cancel-btn">Annuler</button>
      <button class="btn-primary" id="next-btn">Continuer</button>
    </div>
  `);
  document.getElementById("cancel-btn").onclick = closeSheet;
  document.getElementById("next-btn").onclick = async () => {
    const client = await DB.getClient(document.getElementById("f-client-pick").value);
    openInterventionForm(client);
  };
}

async function openInterventionForm(client, existing) {
  const it = existing || {};
  const type = it.type || "entretien";
  const date = it.date || toISO(new Date());
  openSheet(`
    <h2>${existing ? "Modifier l'intervention" : "Nouvelle intervention"}</h2>
    <p style="color:var(--smoke);font-size:13px;margin:-8px 0 14px;">${escapeHtml(clientFullName(client))}</p>
    <div class="form-row"><label>Date</label><input type="date" id="f-date" value="${date}" /></div>
    <div class="form-row">
      <label>Type</label>
      <div class="pill-choice" id="f-type">
        <button type="button" data-val="entretien" class="${type === "entretien" ? "active type-entretien" : ""}">Entretien</button>
        <button type="button" data-val="depannage" class="${type === "depannage" ? "active type-depannage" : ""}">Dépannage</button>
      </div>
    </div>
    <div class="form-row"><label>Description</label><textarea id="f-desc">${escapeHtml(it.description || "")}</textarea></div>
    <div class="sheet-actions">
      <button class="btn-secondary" id="cancel-btn">Annuler</button>
      <button class="btn-primary" id="save-btn">Enregistrer</button>
    </div>
  `);

  let selType = type;
  document.querySelectorAll("#f-type button").forEach((b) => {
    b.onclick = () => {
      selType = b.dataset.val;
      document.querySelectorAll("#f-type button").forEach((x) => x.classList.remove("active", "type-entretien", "type-depannage"));
      b.classList.add("active", b.dataset.val === "entretien" ? "type-entretien" : "type-depannage");
    };
  });

  document.getElementById("cancel-btn").onclick = closeSheet;
  document.getElementById("save-btn").onclick = async () => {
    const item = {
      ...it,
      clientId: client.id,
      date: document.getElementById("f-date").value,
      type: selType,
      description: document.getElementById("f-desc").value.trim(),
    };
    await DB.saveIntervention(item);
    closeSheet();
    toast(existing ? "Intervention mise à jour" : "Intervention ajoutée");
    navigate("fiche", client.id);
  };
}

// ---------- Navigation onglets ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.onclick = () => navigate(btn.dataset.view);
});

// ---------- Toast ----------
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

// ---------- Échappement HTML ----------
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function escapeAttr(str) { return escapeHtml(str); }

// ---------- Service worker (offline) ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => { reg.update(); }).catch(() => {});
  });
}

// ---------- Démarrage ----------
history.replaceState(historySnapshot(), "", "#accueil");
render();
maybeAutoCloudBackup();
maybeAutoCalendarSync();
maybeFridayReminder();
