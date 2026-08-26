/* app.js — SPA légère, sans framework, 100% locale.
   Vues : Accueil / Agenda / Clients / Fiche client / Réglages
   Toute la donnée passe par DB (db.js → IndexedDB). */

const APP_VERSION = "1.32.0"; // Bumper ce numéro (et CACHE_NAME dans sw.js) à chaque mise à jour livrée.

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
  clientFilter: "all",
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
function clientBadge(c) {
  return (c && c.pastilleBleue) ? '<span class="badge-bleue" title="Client marqué"></span>' : "";
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
  const topbar = document.getElementById("topbar");
  if (topbar) topbar.classList.toggle("topbar-compact", state.view !== "accueil");

  if (state.view === "accueil") await renderAccueil();
  else if (state.view === "agenda") await renderAgenda();
  else if (state.view === "clients") await renderClients();
  else if (state.view === "fiche") await renderFiche();
  else if (state.view === "reglages") await renderReglages();
  else if (state.view === "import") await renderImport();

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
          <span class="hb-title">Réglages</span>
          <span class="hb-sub">Version, sauvegarde, point de départ</span>
        </span>
        <svg class="hb-chev" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="home-btn" data-nav="recap-honores">
        <span class="hb-icon"><svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M4 4h16v12H7l-3 3V4zm2 3h12v2H6V7zm0 4h8v2H6v-2z"/></svg></span>
        <span class="hb-text">
          <span class="hb-title">Récapitulatif RDV honorés</span>
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
  root.querySelector('[data-nav="recap-honores"]').onclick = () => openRecapHonores();
}

// ---------- Récapitulatif RDV honorés (facturation) ----------
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
      nomLigne: recapNameLine(c),
      adresse: (c && c.adresse) || r.adresse || "",
      marque: (c && c.marque) || "",
      modele: (c && c.modele) || "",
      raison: r.type === "entretien" ? "Entretien" : "Dépannage",
      paiement: r.paiement || null,
      compteRendu: r.compteRenduHonore || "", // repli pour les RDV honorés avant l'ajout du formulaire structuré
    };
    // Utilise le statut figé sur le rendez-vous au moment où il a été honoré (fiable
    // même si la fiche client est passée à "existant" depuis). Pour les rendez-vous
    // honorés avant l'ajout de ce figeage, on retombe sur l'état actuel de la fiche.
    const etaitNouveau = r.etaitNouveauClient != null ? r.etaitNouveauClient : (c && c.nouveauClient === "oui");
    if (etaitNouveau) nouveaux.push(entry);
    else habituels.push(entry);
  }
  return { nouveaux, habituels };
}

function recapNameLine(c) {
  if (!c) return "Client supprimé";
  const nomMaj = (c.nom || "").toUpperCase();
  return c.prenom ? `${nomMaj}, ${c.prenom}` : nomMaj;
}

function formatRecapEntry(e) {
  const paiementLines = e.paiement ? formatPaiementLines(e.paiement) : (e.compteRendu ? [e.compteRendu] : ["⚠️ Paiement non renseigné"]);
  const lines = [
    `${e.nomLigne} :`,
    e.adresse || "(adresse non renseignée)",
    `Raison : ${e.raison}`,
    `Marque : ${e.marque || "—"}`,
    `Modèle : ${e.modele || "—"}`,
    ...paiementLines,
  ];
  return lines.join("\n");
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

async function openRecapHonores() {
  const recapEmail = await DB.getParam("recapEmail", "");
  if (!recapEmail) {
    toast("Renseigne d'abord une adresse e-mail dans Réglages");
    navigate("reglages");
    return;
  }

  const { startISO, endISO } = currentRecapRange();
  const { nouveaux, habituels } = await buildRecapData(startISO, endISO);

  if (nouveaux.length === 0 && habituels.length === 0) {
    toast("Aucun rendez-vous honoré sur cette période pour l'instant");
    return;
  }

  let body = `Bonjour,\n\nVoici le récapitulatif des interventions honorées du ${fmtDateFullFR(startISO)} au ${fmtDateFullFR(endISO)}.\n\n`;
  if (nouveaux.length) {
    body += "Nouveaux clients :\n\n" + nouveaux.map((e) => formatRecapEntry(e)).join("\n\n") + "\n\n";
  }
  if (habituels.length) {
    body += "Clients existants :\n\n" + habituels.map((e) => formatRecapEntry(e)).join("\n\n") + "\n\n";
  }
  body += "Merci,";

  const subject = `Récapitulatif interventions — semaine du ${fmtDateFR(startISO)} au ${fmtDateFR(endISO)}`;
  window.location.href = `mailto:${recapEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function maybeFridayReminder() {
  const today = new Date();
  if (today.getDay() !== 5) return; // 5 = vendredi
  const todayISO = toISO(today);
  const lastShown = await DB.getParam("lastFridayReminderDate", null);
  if (lastShown === todayISO) return;
  await DB.setParam("lastFridayReminderDate", todayISO);
  toast("N'oublie pas d'envoyer le récapitulatif des RDV honorés aujourd'hui !");
}

async function maybeStaleCalendarWarning() {
  const connected = await isCalendarConnected();
  if (!connected) return;
  const lastSync = await DB.getParam("lastCalendarSyncAt", null);
  const stale = !lastSync || Date.now() - new Date(lastSync).getTime() > 48 * 60 * 60 * 1000;
  if (!stale) return;
  const todayISO = toISO(new Date());
  const lastShown = await DB.getParam("lastStaleCalendarWarningDate", null);
  if (lastShown === todayISO) return;
  await DB.setParam("lastStaleCalendarWarningDate", todayISO);
  toast("⚠️ Google Agenda pas synchronisé depuis plus de 48h — vérifie ta connexion dans Réglages.");
}

// ---------- Vue Agenda (colonnes semaine, façon Google Agenda) ----------
async function renderAgenda() {
  root.innerHTML = `
    <input type="text" class="search-bar" id="agenda-search" placeholder="Rechercher un client dans l'agenda…" value="${escapeHtml(state.agendaSearch)}" />
    <div id="calendar-sync-status"></div>
    <div id="agenda-body"></div>
  `;
  const input = document.getElementById("agenda-search");
  input.oninput = () => { state.agendaSearch = input.value; refreshAgendaBody(); };
  await renderCalendarSyncStatusLine();
  await refreshAgendaBody();
}

function fmtRelativeTime(iso) {
  if (!iso) return "jamais";
  const diffMs = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diffMs / (60 * 60 * 1000));
  if (h < 1) return "à l'instant";
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

async function renderCalendarSyncStatusLine() {
  const el = document.getElementById("calendar-sync-status");
  if (!el) return;
  const connected = await isCalendarConnected();
  if (!connected) { el.innerHTML = ""; return; }
  const lastSync = await DB.getParam("lastCalendarSyncAt", null);
  const stale = !lastSync || Date.now() - new Date(lastSync).getTime() > 48 * 60 * 60 * 1000;
  el.innerHTML = `
    <button type="button" id="agenda-resync-btn" class="link-btn" style="margin:-6px 0 12px;font-size:11.5px;${stale ? "color:var(--danger);" : ""}">
      ${stale ? "⚠️" : "🔄"} Agenda perso synchronisé ${fmtRelativeTime(lastSync)} — appuyer pour resynchroniser
    </button>
  `;
  document.getElementById("agenda-resync-btn").onclick = async () => {
    toast("Synchronisation en cours…");
    const r = await runCalendarSync();
    toast(r.ok ? "Synchronisation réussie ✓" : "Échec : " + r.error);
    await renderCalendarSyncStatusLine();
    await refreshAgendaBody();
  };
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
  const startISO = toISO(days[0]), endISO = toISO(days[days.length - 1]);
  const weekRdvs = await DB.listRendezvousRange(startISO, endISO);
  const byDate = {};
  weekRdvs.forEach((r) => { (byDate[r.date] ||= []).push(r); });

  const clients = await DB.listClients();
  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));
  const today = new Date();
  const domicile = await getDomicileCoords();

  let html = `
    <div class="week-nav">
      <button id="week-prev" aria-label="Semaine précédente">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 6l-6 6 6 6"/></svg>
      </button>
      <button id="week-today" class="week-label">${fmtShort(days[0])} – ${fmtShort(days[days.length - 1])}</button>
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
    const matinItems = items.filter((r) => r.periode === "matin");
    const apremItems = items.filter((r) => r.periode === "apres-midi");
    const autresItems = items.filter((r) => r.periode !== "matin" && r.periode !== "apres-midi");

    html += `<div class="day-col ${isToday ? "is-today" : ""}">
      <div class="day-col-head">
        <div class="dow">${JOURS_COURT[(d.getDay() + 6) % 7]}</div>
        <div class="dnum">${d.getDate()}</div>
      </div>
      ${calEvents.map((ev) => `<div class="cal-chip">📅 ${ev.time ? escapeHtml(ev.time) + " · " : ""}${escapeHtml(ev.title)}</div>`).join("")}
      ${pendingCount >= 2 ? `<button class="day-col-optimize" data-optimize="${iso}" title="Optimiser les trajets">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 2c1 3-1 4-1 6 0 1.2 1 2 2 2 1.3 0 2-1 2-2.2 1.6 1.4 3 3.7 3 6.2a6 6 0 0 1-12 0c0-2.6 1.1-4.3 2.3-6C9.2 6.3 10.5 4.4 12 2Z"/></svg>
      </button>` : ""}
      ${matinItems.length ? `<div class="day-period-label">Matin</div>${matinItems.map((r) => renderRdvChip(r, clientMap, domicile)).join("")}` : ""}
      ${apremItems.length ? `<div class="day-period-label">Après-midi</div>${apremItems.map((r) => renderRdvChip(r, clientMap, domicile)).join("")}` : ""}
      ${autresItems.length ? `<div class="day-period-label">Non précisé</div>${autresItems.map((r) => renderRdvChip(r, clientMap, domicile)).join("")}` : ""}
      <button class="day-col-add" data-add="${iso}">+</button>
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

function renderRdvChip(r, clientMap, domicile) {
  const c = clientMap[r.clientId];
  const name = c ? clientFullName(c) : "Client supprimé";
  const addr = c ? c.adresse : (r.adresse || "");
  const honore = r.statut === "honore";
  const hasComment = c && c.commentaires;

  let distClass = "";
  if (!honore && domicile && c && c.lat != null) {
    const d = haversineKm(domicile.lat, domicile.lon, c.lat, c.lon);
    distClass = d <= 10 ? "dist-green" : d <= 15 ? "dist-orange" : "dist-red";
  }
  const chipClass = honore ? "is-honore" : distClass;
  const typeBadgeClass = r.type === "entretien" ? "type-badge-entretien" : "type-badge-depannage";
  const typeBadgeLabel = r.type === "entretien" ? "Entretien" : "Dépannage";

  return `<button class="rdv-chip ${chipClass}" data-rdv-chip="${r.id}">
    <div class="chip-top-row">
      <span class="type-badge ${typeBadgeClass}">${typeBadgeLabel}</span>
      ${honore ? '<span class="chip-period">✓</span>' : ""}
    </div>
    <span class="chip-name">${hasComment ? '<span title="Commentaire client">⚠️</span> ' : ""}${clientBadge(c)}${escapeHtml(name)}</span>
    ${addr ? `<span class="chip-addr">📍 ${escapeHtml(addr)}</span>` : ""}
  </button>`;
}

async function renderAgendaSearchHtml(query) {
  const todayISO = toISO(new Date());
  const q = normalizeForMatch(query);
  const all = (await DB.listRendezvous()).filter((r) => r.date >= todayISO);
  const clients = await DB.listClients();
  const cmap = Object.fromEntries(clients.map((c) => [c.id, c]));

  const matches = all
    .map((r) => ({ r, c: cmap[r.clientId] }))
    .filter((x) => x.c && normalizeForMatch(clientFullName(x.c)).includes(q))
    .sort((a, b) => a.r.date.localeCompare(b.r.date));

  if (matches.length === 0) {
    return `<div class="empty-state"><span class="emoji">🔍</span>Aucun rendez-vous à venir pour ce client.</div>`;
  }
  return matches.map(({ r, c }) => `
    <button class="near-item-block" data-goto-date="${r.date}">
      <span class="nib-date">${fmtDateFR(r.date)}</span>
      <span class="nib-name">${clientBadge(c)}${escapeHtml(clientFullName(c))}</span>
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
    <p style="color:var(--smoke);font-size:13px;margin:-6px 0 14px;">D'où pars-tu pour cette tournée ? Les périodes Matin et Après-midi sont calculées séparément, puis tu reviens au domicile entre les deux (et à la fin).</p>
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
    optimizeBothPeriods(dateISO, coords);
  };
  document.getElementById("opt-gps").onclick = async () => {
    closeSheet();
    toast("Localisation en cours…");
    const coords = await getCurrentPosition();
    if (!coords) { toast("Localisation indisponible"); return; }
    optimizeBothPeriods(dateISO, coords);
  };
  document.getElementById("opt-none").onclick = () => { closeSheet(); optimizeBothPeriods(dateISO, null); };
}

// Demande (facultative) d'un premier/dernier client pour UNE période donnée.
// Renvoie une Promise résolue avec {forceFirst, forceLast}, ou null si annulé.
function askOrderConstraints(label, rdvs) {
  return new Promise(async (resolve) => {
    const clients = await DB.listClients();
    const cmap = Object.fromEntries(clients.map((c) => [c.id, c]));
    const options = rdvs.map((r) => ({ id: r.id, name: clientFullName(cmap[r.clientId]) || "Client" }));
    const optionsHtml = options.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join("");

    openSheet(`
      <h2>Ordre — ${escapeHtml(label)}</h2>
      <p style="color:var(--smoke);font-size:13px;margin:-6px 0 14px;">Facultatif : impose un client en premier et/ou en dernier pour cette période — le reste sera optimisé automatiquement. Si tu choisis un premier client, le trajet démarre directement chez lui (pas de détour par le point de départ).</p>
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
        <button class="btn-primary" id="go-btn">Continuer</button>
      </div>
    `);
    document.getElementById("cancel-btn").onclick = () => { closeSheet(); resolve(null); };
    document.getElementById("go-btn").onclick = () => {
      const forceFirst = document.getElementById("f-force-first").value || null;
      const forceLast = document.getElementById("f-force-last").value || null;
      if (forceFirst && forceFirst === forceLast) { toast("Choisis deux clients différents pour le premier et le dernier"); return; }
      closeSheet();
      resolve({ forceFirst, forceLast });
    };
  });
}

// Calcule et enregistre l'ordre optimisé pour un lot de rendez-vous (une période).
async function computeOptimizedRoute(rdvs, depart, forceFirstId, forceLastId) {
  const clients = await DB.listClients();
  const cmap = Object.fromEntries(clients.map((c) => [c.id, c]));
  const points = [];
  let missing = 0;
  for (const r of rdvs) {
    const c = cmap[r.clientId];
    if (c && c.lat != null) points.push({ id: r.id, lat: c.lat, lon: c.lon, name: clientFullName(c), badge: clientBadge(c) });
    else missing++;
  }
  if (points.length < 2) return { error: "Pas assez de clients géocodés sur cette période (minimum 2).", missing };

  const result = await optimizeTripConstrained(points, depart, true, forceFirstId, forceLastId);
  for (const rdvId of result.order) {
    const r = rdvs.find((x) => x.id === rdvId);
    if (r) r.ordre = result.order.indexOf(rdvId);
  }
  for (const r of rdvs) if (r.ordre != null && points.some((p) => p.id === r.id)) await DB.saveRendezvous(r);

  const names = result.order.map((id) => points.find((p) => p.id === id)).filter(Boolean).map((p) => `${p.badge}${escapeHtml(p.name)}`);
  return { names, missing, distanceKm: result.distanceKm, durationMin: result.durationMin, estimated: result.estimated, startsAtClient: !!forceFirstId };
}

// Orchestre l'optimisation Matin puis Après-midi séparément, puis affiche le résultat combiné.
async function optimizeBothPeriods(dateISO, depart) {
  const allRdvs = (await DB.listRendezvous()).filter((r) => r.date === dateISO && r.statut !== "honore");
  const groups = [
    { key: "matin", label: "Matin", rdvs: allRdvs.filter((r) => r.periode === "matin") },
    { key: "apres-midi", label: "Après-midi", rdvs: allRdvs.filter((r) => r.periode !== "matin") },
  ].filter((g) => g.rdvs.length >= 2);

  if (groups.length === 0) {
    toast("Il faut au moins 2 rendez-vous géocodés sur une même période (matin ou après-midi) pour optimiser");
    return;
  }

  const outcomes = [];
  for (const g of groups) {
    const constraints = await askOrderConstraints(g.label, g.rdvs);
    if (constraints === null) return; // annulé en cours de route
    const outcome = await computeOptimizedRoute(g.rdvs, depart, constraints.forceFirst, constraints.forceLast);
    outcomes.push({ label: g.label, ...outcome });
  }

  const sections = outcomes.map((o) => {
    if (o.error) return `<div class="info-block"><h3>${escapeHtml(o.label)}</h3><p class="near-hint">${escapeHtml(o.error)}</p></div>`;
    const steps = (o.startsAtClient || !depart) ? o.names : ["Départ", ...o.names];
    return `
      <div class="info-block">
        <h3>${escapeHtml(o.label)}</h3>
        ${o.missing > 0 ? `<p style="color:var(--smoke);font-size:12px;margin:0 0 8px;">${o.missing} client(s) non géocodé(s) ignoré(s).</p>` : ""}
        ${o.estimated ? `<p style="color:var(--ember);font-size:12px;margin:0 0 8px;">⚠️ Calcul routier indisponible — estimation à vol d'oiseau.</p>` : ""}
        <div class="near-list">${steps.map((n, i) => `<div class="near-item"><span>${i + 1}. ${n}</span></div>`).join("")}</div>
        <div class="info-row" style="margin-top:8px;"><span class="k">Distance</span><span class="v">${o.distanceKm.toFixed(1)} km</span></div>
        ${o.durationMin != null ? `<div class="info-row"><span class="k">Durée estimée</span><span class="v">${Math.round(o.durationMin)} min</span></div>` : ""}
      </div>
    `;
  }).join("");

  openSheet(`
    <h2>Trajets optimisés</h2>
    ${sections}
    <div class="sheet-actions"><button class="btn-primary" id="ok-btn" style="width:100%;">OK</button></div>
  `);
  document.getElementById("ok-btn").onclick = () => { closeSheet(); refreshAgendaBody(); };
}

// ---------- Vue Clients ----------
async function getFilteredClients() {
  let clients = await DB.searchClients(state.clientSearch);
  if (state.clientFilter === "imported") clients = clients.filter((c) => c.source === "import");
  else if (state.clientFilter === "nogeo") clients = clients.filter((c) => c.adresse && c.lat == null);
  return clients;
}

async function renderClients() {
  const allClients = await DB.listClients();
  const importedCount = allClients.filter((c) => c.source === "import").length;
  const nogeoCount = allClients.filter((c) => c.adresse && c.lat == null).length;
  const clients = await getFilteredClients();

  let html = `<h2 class="view-heading">Clients</h2>`;
  if (importedCount > 0 || nogeoCount > 0) {
    html += `
      <div class="pill-choice" id="client-filter-tabs" style="margin-bottom:10px;">
        <button type="button" data-val="all" class="${state.clientFilter === "all" ? "active period-active" : ""}">Tous</button>
        ${importedCount > 0 ? `<button type="button" data-val="imported" class="${state.clientFilter === "imported" ? "active period-active" : ""}">Importés (${importedCount})</button>` : ""}
        ${nogeoCount > 0 ? `<button type="button" data-val="nogeo" class="${state.clientFilter === "nogeo" ? "active period-active" : ""}">Non géocodés (${nogeoCount})</button>` : ""}
      </div>
    `;
    if (state.clientFilter === "imported") {
      html += `<button class="btn-danger" id="delete-all-imported-btn" style="width:100%;margin-bottom:10px;">Supprimer tous les clients importés (${importedCount})</button>`;
    }
  }
  html += `<input type="text" class="search-bar" id="client-search" placeholder="Rechercher un client (nom, adresse, téléphone)" value="${escapeHtml(state.clientSearch)}" />`;

  if (clients.length === 0) {
    html += `<div class="empty-state"><span class="emoji">🔍</span>${state.clientSearch ? "Aucun client trouvé." : (state.clientFilter === "imported" ? "Aucun client importé pour l'instant." : state.clientFilter === "nogeo" ? "Tous les clients sont géocodés 🎉" : "Aucun client pour l'instant.<br>Ajoute ton premier client avec le bouton +.")}</div>`;
  } else {
    html += clients.map((c) => clientRowHtml(c)).join("");
  }

  root.innerHTML = html;
  const filterTabs = document.getElementById("client-filter-tabs");
  if (filterTabs) {
    filterTabs.querySelectorAll("button").forEach((b) => {
      b.onclick = () => { state.clientFilter = b.dataset.val; renderClients(); };
    });
  }
  const deleteAllBtn = document.getElementById("delete-all-imported-btn");
  if (deleteAllBtn) deleteAllBtn.onclick = () => confirmDeleteAllImported(importedCount);
  const input = document.getElementById("client-search");
  input.oninput = () => { state.clientSearch = input.value; renderClientsListOnly(); };
  root.querySelectorAll("[data-client]").forEach((el) => {
    el.onclick = () => navigate("fiche", el.dataset.client);
  });
}

async function confirmDeleteAllImported(count) {
  openSheet(`
    <h2>Supprimer les ${count} clients importés ?</h2>
    <p style="color:var(--smoke);font-size:14px;">Cette action supprime définitivement toutes les fiches encore marquées "Client importé" (jamais modifiées depuis leur création), ainsi que leur éventuel historique. Les clients déjà vérifiés et modifiés ne sont pas concernés.</p>
    <div class="sheet-actions">
      <button class="btn-secondary" id="cancel-btn">Annuler</button>
      <button class="btn-danger" id="confirm-btn">Supprimer</button>
    </div>
  `);
  document.getElementById("cancel-btn").onclick = closeSheet;
  document.getElementById("confirm-btn").onclick = async () => {
    const toDelete = (await DB.listClients()).filter((c) => c.source === "import");
    for (const c of toDelete) {
      const hist = await DB.listInterventionsForClient(c.id);
      for (const h of hist) await DB.deleteIntervention(h.id);
      await DB.deleteClient(c.id);
    }
    closeSheet();
    toast(`${toDelete.length} client(s) importé(s) supprimé(s)`);
    state.clientFilter = "all";
    render();
  };
}

function clientRowHtml(c) {
  return `<button class="client-row" data-client="${c.id}">
    <span class="client-avatar">${initials(c)}</span>
    <span>
      <span class="cname">${clientBadge(c)}${escapeHtml(clientFullName(c))} ${c.lat != null ? '<span class="geo-dot geo-dot-ok" title="Adresse géocodée"></span>' : (c.adresse ? '<span class="geo-dot geo-dot-missing" title="Adresse non géocodée"></span>' : "")}</span>
      <span class="caddr">${escapeHtml(c.adresse || "Adresse non renseignée")}</span>
    </span>
    <span class="chevron">
      <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </span>
  </button>`;
}

async function renderClientsListOnly() {
  const clients = await getFilteredClients();
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
      <p class="fname">${clientBadge(c)}${escapeHtml(clientFullName(c))}</p>
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
      <div class="info-row"><span class="k">Téléphone</span><span class="v">${c.telephone ? `<a href="tel:${c.telephone.replace(/\s+/g, "")}" style="color:inherit;text-decoration:underline;">${escapeHtml(c.telephone)}</a>` : "—"}</span></div>
      ${c.telephone2 ? `<div class="info-row"><span class="k">Téléphone secondaire</span><span class="v"><a href="tel:${c.telephone2.replace(/\s+/g, "")}" style="color:inherit;text-decoration:underline;">${escapeHtml(c.telephone2)}</a></span></div>` : ""}
      ${c.email ? `<div class="info-row"><span class="k">E-mail</span><span class="v">${escapeHtml(c.email)}</span></div>` : ""}
      <div class="info-row"><span class="k">Nouveau client</span><span class="v">${nouveauClientLabel(c)}</span></div>
    </div>

    ${c.commentaires ? `<div class="info-block"><h3>Commentaires</h3><p class="comment-text">${escapeHtml(c.commentaires)}</p></div>` : ""}

    <div class="info-block">
      <h3>Photos</h3>
      <div id="client-photos-grid">${photoGridHtml(c.photos, true)}</div>
      <input type="file" accept="image/*" capture="environment" multiple id="client-photo-input" hidden />
      <button class="btn-secondary" id="client-photo-add-btn" style="width:100%;margin-top:8px;">+ Ajouter une photo</button>
    </div>

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
              ${photoGridHtml(h.photos, false)}
              <div class="hist-actions">
                <button class="link-btn" data-edit-hist="${h.id}">Modifier</button>
                <button class="link-btn" data-del-hist="${h.id}">Supprimer</button>
              </div>
            </div>`).join("")}
      </div>
    </div>

    <button class="btn-secondary" id="share-client-btn" style="width:100%;margin-bottom:10px;">Partager la fiche</button>

    <div class="sheet-actions" style="margin-bottom:16px;">
      <button class="btn-secondary" id="edit-client-btn">Modifier la fiche</button>
      <button class="btn-danger" id="del-client-btn">Supprimer</button>
    </div>
  `;

  document.getElementById("qa-rdv").onclick = () => openRdvForm({ clientId: c.id });
  document.getElementById("share-client-btn").onclick = () => openClientShare(c, historique);
  document.getElementById("edit-client-btn").onclick = () => openClientForm(c);
  document.getElementById("del-client-btn").onclick = () => confirmDeleteClient(c);

  document.getElementById("client-photo-add-btn").onclick = () => document.getElementById("client-photo-input").click();
  document.getElementById("client-photo-input").onchange = async (e) => {
    const newPhotos = await resizeImageFilesToDataURLs(e.target.files);
    if (newPhotos.length === 0) return;
    const fresh = await DB.getClient(c.id);
    if (fresh) {
      fresh.photos = [...(fresh.photos || []), ...newPhotos];
      await DB.saveClient(fresh);
      toast("Photo ajoutée ✓");
      render();
    }
  };
  document.querySelectorAll("#client-photos-grid .photo-remove").forEach((btn) => {
    btn.onclick = async () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const fresh = await DB.getClient(c.id);
      if (fresh) {
        fresh.photos = (fresh.photos || []).filter((_, i) => i !== idx);
        await DB.saveClient(fresh);
        render();
      }
    };
  });

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

// ---------- Partage d'une fiche client (SMS / e-mail / partage natif) ----------
function buildClientShareText(c, historique) {
  const lines = [`Fiche client — ${clientFullName(c)}`, ""];
  if (c.adresse) lines.push(`Adresse : ${c.adresse}`);
  if (c.telephone) lines.push(`Téléphone : ${c.telephone}`);
  if (c.telephone2) lines.push(`Téléphone secondaire : ${c.telephone2}`);
  if (c.email) lines.push(`E-mail : ${c.email}`);
  lines.push(`Nouveau client : ${nouveauClientLabel(c)}`);

  if (c.marque || c.modele || c.infosComplementaires) {
    lines.push("", "Installation");
    if (c.marque) lines.push(`Marque : ${c.marque}`);
    if (c.modele) lines.push(`Modèle : ${c.modele}`);
    if (c.infosComplementaires) lines.push(`Infos : ${c.infosComplementaires}`);
  }

  if (c.commentaires) lines.push("", "Commentaires", c.commentaires);

  lines.push("", "Historique des interventions");
  if (!historique || historique.length === 0) {
    lines.push("Aucune intervention enregistrée.");
  } else {
    historique.forEach((h) => {
      const typeLabel = h.type === "entretien" ? "Entretien" : "Dépannage";
      lines.push(`- ${fmtDateFR(h.date)} — ${typeLabel}${h.description ? " : " + h.description : ""}`);
    });
  }
  return lines.join("\n");
}

function collectClientPhotos(c, historique) {
  const photos = [];
  const safeName = clientFullName(c).replace(/[^\wÀ-ÿ-]+/g, "-");
  (c.photos || []).forEach((src, i) => photos.push({ src, name: `${safeName}-${i + 1}.jpg` }));
  (historique || []).forEach((h) => {
    (h.photos || []).forEach((src, i) => photos.push({ src, name: `${safeName}-${h.date}-${i + 1}.jpg` }));
  });
  return photos;
}

async function dataUrlToFile(dataUrl, filename) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

async function openClientShare(c, historique) {
  const text = buildClientShareText(c, historique);
  const photos = collectClientPhotos(c, historique);
  const canNativeShare = typeof navigator.share === "function";

  openSheet(`
    <h2>Partager la fiche</h2>
    <p class="near-hint" style="margin:0 0 14px;">Coordonnées, installation, commentaires et historique complet${photos.length ? ` (+ ${photos.length} photo${photos.length > 1 ? "s" : ""})` : ""}.</p>
    ${canNativeShare ? `<button class="btn-primary" id="share-native-btn" style="width:100%;margin-bottom:12px;">Partager${photos.length ? " (avec les photos)" : ""}</button>` : ""}
    <div class="sheet-actions" style="margin-top:0;">
      <button class="btn-secondary" id="share-sms-btn">Par SMS</button>
      <button class="btn-secondary" id="share-email-btn">Par e-mail</button>
    </div>
    ${photos.length ? '<p class="near-hint" style="margin-top:12px;">Par SMS ou e-mail classique, seul le texte part — les photos ne peuvent pas être jointes de cette façon (limite du téléphone). Utilise "Partager" ci-dessus pour les inclure.</p>' : ""}
  `);

  const nativeBtn = document.getElementById("share-native-btn");
  if (nativeBtn) {
    nativeBtn.onclick = async () => {
      try {
        const shareData = { title: `Fiche client — ${clientFullName(c)}`, text };
        if (photos.length) {
          const files = await Promise.all(photos.map((p) => dataUrlToFile(p.src, p.name)));
          if (navigator.canShare && navigator.canShare({ files })) shareData.files = files;
        }
        await navigator.share(shareData);
        closeSheet();
      } catch (e) {
        if (e.name !== "AbortError") toast("Partage impossible : " + e.message);
      }
    };
  }
  document.getElementById("share-sms-btn").onclick = () => {
    window.location.href = `sms:?body=${encodeURIComponent(text)}`;
    closeSheet();
  };
  document.getElementById("share-email-btn").onclick = () => {
    window.location.href = `mailto:?subject=${encodeURIComponent("Fiche client — " + clientFullName(c))}&body=${encodeURIComponent(text)}`;
    closeSheet();
  };
}

// ---------- Comparatif des marques installées ----------
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}
function normalizeBrand(s) {
  return normalizeForMatch(s).replace(/[^a-z0-9]/g, "");
}

// Regroupe les marques dont l'orthographe se ressemble (ex : "Extraflamme" / "Extraflame" /
// "EXTRA FLAMME") sous une seule entrée, sans liste de marques prédéfinie à maintenir.
// Regroupe aussi explicitement quelques marques sœurs connues (même groupe industriel).
const BRAND_GROUP_ALIASES = {
  nordica: "nordicaextraflame",
  extraflame: "nordicaextraflame",
  devillepegase: "deville",
};
const BRAND_GROUP_LABELS = {
  nordicaextraflame: "NORDICA / EXTRAFLAME",
  deville: "DEVILLE",
};

async function computeBrandStats() {
  const clients = await DB.listClients();
  const counts = new Map();
  clients.forEach((c) => {
    const raw = (c.marque || "").trim();
    if (!raw) return;
    let norm = normalizeBrand(raw);
    if (!norm) return;
    if (BRAND_GROUP_ALIASES[norm]) norm = BRAND_GROUP_ALIASES[norm];
    if (!counts.has(norm)) counts.set(norm, { count: 0, labels: new Map() });
    const entry = counts.get(norm);
    entry.count++;
    entry.labels.set(raw, (entry.labels.get(raw) || 0) + 1);
  });

  const entries = Array.from(counts.entries()).sort((a, b) => b[1].count - a[1].count);
  const clusters = [];
  entries.forEach(([norm, data]) => {
    let target = null;
    for (const cl of clusters) {
      const threshold = Math.max(1, Math.floor(Math.max(cl.key.length, norm.length) * 0.25));
      if (levenshtein(cl.key, norm) <= threshold) { target = cl; break; }
    }
    if (target) {
      target.count += data.count;
      data.labels.forEach((c, label) => target.labels.set(label, (target.labels.get(label) || 0) + c));
    } else {
      clusters.push({ key: norm, count: data.count, labels: new Map(data.labels) });
    }
  });

  const results = clusters.map((cl) => {
    if (BRAND_GROUP_LABELS[cl.key]) return { label: BRAND_GROUP_LABELS[cl.key], count: cl.count };
    let bestLabel = "", bestCount = -1;
    cl.labels.forEach((c, label) => { if (c > bestCount) { bestCount = c; bestLabel = label; } });
    return { label: bestLabel.toUpperCase(), count: cl.count };
  }).sort((a, b) => b.count - a.count);

  const total = results.reduce((s, r) => s + r.count, 0);
  return { results, total };
}

async function renderBrandStats() {
  const el = document.getElementById("brand-stats");
  if (!el) return;
  const { results, total } = await computeBrandStats();
  if (total === 0) {
    el.innerHTML = '<p class="near-hint">Aucune marque renseignée pour l\'instant sur les fiches clients.</p>';
    return;
  }
  el.innerHTML = results.map((r) => {
    const pct = ((r.count / total) * 100).toFixed(1);
    return `
      <div style="margin-bottom:11px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
          <span>${escapeHtml(r.label)}</span>
          <span style="color:var(--smoke);font-family:var(--font-mono);">${r.count} · ${pct}%</span>
        </div>
        <div style="background:var(--surface-2);border-radius:6px;height:10px;overflow:hidden;">
          <div style="background:var(--ember);height:100%;width:${pct}%;"></div>
        </div>
      </div>
    `;
  }).join("");
}

// ---------- Réglages ----------
async function renderReglages() {
  const clientsSansGeo = (await DB.listClients()).filter((c) => c.adresse && c.lat == null).length;
  const recapEmail = await DB.getParam("recapEmail", "");

  root.innerHTML = `
    <h2 class="view-heading">Réglages</h2>

    <div class="info-block">
      <h3>À propos</h3>
      <div class="info-row"><span class="k">Version de l'application</span><span class="v">${APP_VERSION}</span></div>
    </div>

    <div class="info-block">
      <h3>Géocodage</h3>
      <p style="font-size:13.5px;color:var(--smoke);margin:0 0 12px;">
        ${clientsSansGeo > 0 ? `${clientsSansGeo} adresse(s) client en attente de géocodage.` : "Toutes les adresses connues sont géocodées."}
      </p>
      <button class="btn-secondary" id="geocode-all-btn" style="width:100%;" ${clientsSansGeo === 0 ? "disabled" : ""}>Géocoder les adresses en attente</button>
    </div>

    <div class="info-block">
      <h3>Marques installées</h3>
      <p style="font-size:12.5px;color:var(--smoke);margin:0 0 12px;">Part de chaque marque parmi les fiches clients. Les orthographes proches (ex : "Extraflamme"/"Extraflame") sont regroupées automatiquement.</p>
      <div id="brand-stats"></div>
    </div>

    <div class="info-block">
      <h3>Récapitulatif RDV honorés</h3>
      <div class="form-row" style="margin-bottom:8px;">
        <label for="recap-email-input">Adresse e-mail du destinataire</label>
        <input type="email" id="recap-email-input" value="${escapeHtml(recapEmail)}" placeholder="exemple@email.com" />
      </div>
      <button class="btn-primary" id="save-recap-email" style="width:100%;">Enregistrer</button>
    </div>

    <div class="info-block">
      <h3>Sauvegarde (Google Drive)</h3>
      <div id="drive-status"></div>
    </div>

    <div class="info-block">
      <h3>Ajouter un fichier à Drive</h3>
      <input type="file" accept="application/json" id="local-import-file" hidden />
      <button class="btn-secondary" id="local-import-btn" style="width:100%;">Choisir un fichier</button>
    </div>

    <div class="info-block">
      <h3>Google Agenda (lecture seule)</h3>
      <div id="calendar-status"></div>
    </div>
  `;

  document.getElementById("save-recap-email").onclick = async () => {
    await DB.setParam("recapEmail", document.getElementById("recap-email-input").value.trim());
    toast("Adresse enregistrée");
  };

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
  await renderBrandStats();

  const localImportInput = document.getElementById("local-import-file");
  document.getElementById("local-import-btn").onclick = () => localImportInput.click();
  localImportInput.onchange = async () => {
    const file = localImportInput.files[0];
    if (!file) return;
    localImportInput.value = ""; // permet de resélectionner le même fichier plus tard si besoin

    const connected = await isDriveConnected();
    if (!connected) {
      toast("Connecte d'abord Google Drive ci-dessus");
      return;
    }
    try {
      const text = await file.text();
      JSON.parse(text); // vérifie que c'est bien un JSON valide avant l'envoi
      toast("Envoi vers Drive…");
      await driveUploadBackup(text);
      toast("Envoyé sur Drive ✓ — choisis-le pour l'importer");
      openBackupPicker();
    } catch (e) {
      toast("Échec : " + e.message);
    }
  };
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

// L'indicateur "connecté" peut, dans de rares cas, ne pas survivre à une fermeture
// complète de l'appli (particularité connue des PWA Android autour des écrans de
// connexion Google, qui basculent brièvement l'appli en arrière-plan). On se base
// donc aussi sur une preuve indirecte — une synchronisation déjà réussie — pour ne
// pas perdre le statut "connecté" même si l'indicateur lui-même a été perdu.
async function isDriveConnected() {
  const flag = await DB.getParam("driveConnected", false);
  if (flag) return true;
  const last = await DB.getParam("lastCloudBackupAt", null);
  return !!last;
}
async function isCalendarConnected() {
  const flag = await DB.getParam("calendarConnected", false);
  if (flag) return true;
  const last = await DB.getParam("lastCalendarSyncAt", null);
  return !!last;
}

async function maybeAutoCloudBackup() {
  const connected = await isDriveConnected();
  if (!connected) return;
  await DB.setParam("driveConnected", true); // auto-réparation si l'indicateur avait été perdu
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
    // Seuls les événements marqués "RDV"/"rdv" par ton père sont repris — le reste de
    // son agenda personnel (médecin, famille, etc.) n'est pas importé dans l'appli.
    const rdvEvents = events.filter((e) => /rdv/i.test(`${e.title} ${e.description || ""}`));
    const byDate = {};
    rdvEvents.forEach((e) => { (byDate[e.date] ||= []).push({ time: e.time, title: e.title }); });
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
  const connected = await isCalendarConnected();
  if (!connected) return;
  await DB.setParam("calendarConnected", true); // auto-réparation si l'indicateur avait été perdu
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
  const connected = await isCalendarConnected();
  const lastSync = await DB.getParam("lastCalendarSyncAt", null);
  const lastError = await DB.getParam("lastCalendarError", null);

  if (connected) await DB.setParam("calendarConnected", true); // auto-réparation

  if (!connected) {
    el.innerHTML = `
      <p style="font-size:13.5px;color:var(--smoke);margin:0 0 12px;">Affiche dans l'appli, en lecture seule, les événements de ton Google Agenda dont le titre ou la description contient "RDV" — pour éviter les doubles réservations sans reprendre tout ton agenda personnel.</p>
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
    <button class="btn-secondary" id="cal-import-btn" style="width:100%;margin-top:10px;">Importer les clients depuis l'historique (2024–2027)</button>
    <button class="btn-danger" id="cal-disconnect-btn" style="width:100%;margin-top:10px;">Déconnecter</button>
  `;
  document.getElementById("cal-sync-btn").onclick = async () => {
    toast("Synchronisation en cours…");
    const r = await runCalendarSync();
    toast(r.ok ? "Synchronisation réussie ✓" : "Échec : " + r.error);
    renderCalendarStatus();
  };
  document.getElementById("cal-import-btn").onclick = () => navigate("import");
  document.getElementById("cal-disconnect-btn").onclick = async () => {
    calendarDisconnect();
    await DB.setParam("calendarConnected", false);
    toast("Déconnecté de Google Agenda");
    renderCalendarStatus();
  };
}

// ---------- Import de clients depuis l'historique Google Agenda ----------
const IMPORT_RANGE_START = "2024-01-01T00:00:00Z";
const IMPORT_RANGE_END = "2028-01-01T00:00:00Z"; // couvre 2024 à 2027 inclus

// Mots-clés d'événements personnels/non-clients à exclure de l'import (rendez-vous
// médicaux, loisirs, administratif...). Comparaison insensible aux accents et à la casse.
const IMPORT_EXCLUDED_KEYWORDS = [
  "anniversaire", "cardiologue", "docteur", "coiffeur", "coiffeuse", "comptabilite",
  "comportementaliste", "vacance", "examen", "sport", "revision",
  "reunion", "rdv", "petel", "kine",
];

function normalizeForMatch(str) {
  return (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function isExcludedCalendarEvent(text) {
  const norm = normalizeForMatch(text);
  return IMPORT_EXCLUDED_KEYWORDS.some((kw) => norm.includes(kw));
}

function extractCandidateFromEvent(ev) {
  const title = (ev.summary || "").trim();
  const desc = (ev.description || "").trim();
  const full = `${title}\n${desc}`;
  if (!title) return null;
  if (isExcludedCalendarEvent(full)) return null;

  const phoneMatch = full.match(/0[1-9](?:[\s.-]?\d{2}){4}/);
  const emailMatch = full.match(/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/);
  const postalMatch = full.match(/\b\d{5}\b/);
  let adresse = "";
  if (postalMatch) {
    const idx = postalMatch.index;
    const start = Math.max(0, idx - 60);
    const end = Math.min(full.length, idx + 30);
    adresse = full.slice(start, end).replace(/\s+/g, " ").trim();
  }

  const startDate = (ev.start && (ev.start.date || (ev.start.dateTime || "").slice(0, 10))) || "";

  return {
    nom: title,
    telephone: phoneMatch ? phoneMatch[0].trim() : "",
    email: emailMatch ? emailMatch[0].trim() : "",
    adresse,
    date: startDate,
  };
}

async function runCalendarImportScan(onProgress) {
  const rawEvents = await calendarFetchEventsRaw(IMPORT_RANGE_START, IMPORT_RANGE_END, onProgress);
  const candidatesMap = new Map();

  for (const ev of rawEvents) {
    const c = extractCandidateFromEvent(ev);
    if (!c) continue;
    const key = c.telephone ? c.telephone.replace(/\D/g, "") : c.nom.toLowerCase();
    if (!candidatesMap.has(key)) {
      candidatesMap.set(key, { ...c, key, occurrences: c.date ? [c.date] : [] });
    } else {
      const existing = candidatesMap.get(key);
      if (c.date) existing.occurrences.push(c.date);
      if (!existing.telephone && c.telephone) existing.telephone = c.telephone;
      if (!existing.email && c.email) existing.email = c.email;
      if (!existing.adresse && c.adresse) existing.adresse = c.adresse;
    }
  }

  const excludedKeys = new Set((await DB.getParam("importExcludedKeys", [])) || []);

  const candidates = Array.from(candidatesMap.values())
    .filter((c) => !excludedKeys.has(c.key))
    .map((c, i) => ({
      id: "cand_" + i + "_" + Math.random().toString(36).slice(2, 8),
      key: c.key,
      nom: c.nom,
      telephone: c.telephone,
      email: c.email,
      adresse: c.adresse,
      occurrences: c.occurrences.sort(),
    }));

  await DB.setParam("importCandidates", candidates);
  await DB.setParam("importScanAt", new Date().toISOString());
  return candidates;
}

async function excludeImportCandidatePermanently(key) {
  if (!key) return;
  const current = (await DB.getParam("importExcludedKeys", [])) || [];
  if (!current.includes(key)) {
    current.push(key);
    await DB.setParam("importExcludedKeys", current);
  }
}

function findLikelyDuplicateClient(candidate, clients) {
  const candPhone = (candidate.telephone || "").replace(/\D/g, "");
  for (const c of clients) {
    const cPhone = (c.telephone || "").replace(/\D/g, "");
    if (candPhone && cPhone && candPhone === cPhone) return c;
    if (clientFullName(c).trim().toLowerCase() === candidate.nom.trim().toLowerCase()) return c;
  }
  return null;
}

async function renderImport() {
  const candidates = await DB.getParam("importCandidates", null);
  const scanAt = await DB.getParam("importScanAt", null);

  if (!candidates) {
    root.innerHTML = `
      <h2 class="view-heading">Import depuis Google Agenda</h2>
      <div class="info-block">
        <p style="font-size:13.5px;color:var(--ink-dim);margin:0 0 14px;">Récupère tous les événements de 2024 à 2027 depuis le Google Agenda déjà connecté, et propose de créer une fiche client pour chaque personne détectée — après vérification, rien n'est créé automatiquement.</p>
        <button class="btn-primary" id="scan-btn" style="width:100%;">Analyser 2024–2027</button>
      </div>
    `;
    document.getElementById("scan-btn").onclick = async () => {
      toast("Récupération des événements…");
      try {
        const found = await runCalendarImportScan((n) => toast(`Récupération en cours… (${n} événements)`));
        toast(`Analyse terminée — ${found.length} personnes détectées`);
        render();
      } catch (e) {
        toast("Échec : " + e.message);
      }
    };
    return;
  }

  const clients = await DB.listClients();
  let html = `
    <h2 class="view-heading">Import depuis Google Agenda</h2>
    <p style="font-size:12.5px;color:var(--smoke);margin:-10px 0 14px;">Analyse du ${scanAt ? fmtDateTimeFR(scanAt) : ""} — ${candidates.length} personne(s) détectée(s). Vérifie et corrige avant de créer les fiches. Tu peux traiter les fiches une par une, ou en cocher plusieurs pour les créer d'un coup.</p>
    <div class="sheet-actions" style="margin-bottom:14px;">
      <button class="btn-secondary" id="rescan-btn">Relancer l'analyse</button>
    </div>
    <div class="sheet-actions" style="margin-bottom:14px;">
      <button class="btn-secondary" id="select-all-btn">Tout cocher</button>
      <button class="btn-secondary" id="deselect-all-btn">Tout décocher</button>
    </div>
    <div id="import-list"></div>
    <button class="btn-primary" id="create-selected-btn" style="width:100%;margin:14px 0 30px;">Créer les fiches cochées</button>
  `;
  root.innerHTML = html;

  const listEl = document.getElementById("import-list");
  listEl.innerHTML = candidates.map((c) => {
    const dup = findLikelyDuplicateClient(c, clients);
    const period = c.occurrences.length ? `${fmtDateFR(c.occurrences[0])} → ${fmtDateFR(c.occurrences[c.occurrences.length - 1])}` : "";
    return `
      <div class="info-block" data-cand-id="${c.id}" data-cand-key="${escapeAttr(c.key)}" style="margin-top:8px;">
        ${dup ? `<p class="geo-status geo-pending" style="margin:0 0 8px;">⚠️ Client existant probable : ${escapeHtml(clientFullName(dup))}</p>` : ""}
        <div class="form-row-2">
          <div class="form-row" style="margin-bottom:8px;"><label>Nom</label><input type="text" class="cand-nom" value="${escapeAttr(c.nom)}" /></div>
          <div class="form-row" style="margin-bottom:8px;"><label>Téléphone</label><input type="text" class="cand-tel" value="${escapeAttr(c.telephone)}" /></div>
        </div>
        <div class="form-row" style="margin-bottom:8px;"><label>Adresse</label><input type="text" class="cand-adresse" value="${escapeAttr(c.adresse)}" /></div>
        <p class="near-hint" style="margin:0 0 8px;">Vu ${c.occurrences.length} fois${period ? " · " + period : ""}</p>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;">
            <input type="checkbox" class="cand-select" ${dup ? "" : "checked"} />
            Sélectionner
          </label>
          <div style="display:flex;gap:14px;align-items:center;">
            <button type="button" class="link-btn cand-dismiss">Ignorer</button>
            <button type="button" class="link-btn cand-delete" style="color:var(--danger);">Supprimer</button>
            <button type="button" class="btn-secondary cand-create-one" style="padding:8px 14px;">Créer cette fiche</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  async function createFromRow(row) {
    const nom = row.querySelector(".cand-nom").value.trim();
    if (!nom) { toast("Le nom est requis"); return false; }
    const client = {
      nom,
      prenom: "",
      telephone: row.querySelector(".cand-tel").value.trim(),
      adresse: row.querySelector(".cand-adresse").value.trim(),
      nouveauClient: "non",
      source: "import",
    };
    const saved = await DB.saveClient(client);
    if (client.adresse) {
      geocodeAddress(client.adresse).then(async (coords) => {
        if (!coords) return;
        const fresh = await DB.getClient(saved.id);
        if (fresh) { fresh.lat = coords.lat; fresh.lon = coords.lon; fresh.geocodeStatus = "ok"; await DB.saveClient(fresh); }
      });
    }
    // Une fois créée, cette personne ne doit plus jamais réapparaître dans une future analyse.
    await excludeImportCandidatePermanently(row.dataset.candKey);
    return true;
  }

  async function removeCandidateFromStorage(candId) {
    const current = (await DB.getParam("importCandidates", [])) || [];
    await DB.setParam("importCandidates", current.filter((x) => x.id !== candId));
  }

  listEl.querySelectorAll("[data-cand-id]").forEach((row) => {
    const candId = row.dataset.candId;
    const candKey = row.dataset.candKey;
    row.querySelector(".cand-dismiss").onclick = async () => {
      await removeCandidateFromStorage(candId);
      row.remove();
    };
    row.querySelector(".cand-delete").onclick = async () => {
      await removeCandidateFromStorage(candId);
      await excludeImportCandidatePermanently(candKey);
      toast("Ne réapparaîtra plus lors des prochaines analyses");
      row.remove();
    };
    row.querySelector(".cand-create-one").onclick = async () => {
      const ok = await createFromRow(row);
      if (!ok) return;
      await removeCandidateFromStorage(candId);
      toast("Fiche créée ✓");
      row.remove();
    };
  });

  document.getElementById("select-all-btn").onclick = () => {
    listEl.querySelectorAll(".cand-select").forEach((cb) => { cb.checked = true; });
  };
  document.getElementById("deselect-all-btn").onclick = () => {
    listEl.querySelectorAll(".cand-select").forEach((cb) => { cb.checked = false; });
  };

  document.getElementById("rescan-btn").onclick = async () => {
    toast("Nouvelle analyse en cours…");
    try {
      const found = await runCalendarImportScan((n) => toast(`Récupération en cours… (${n} événements)`));
      toast(`Analyse terminée — ${found.length} personnes détectées`);
      render();
    } catch (e) {
      toast("Échec : " + e.message);
    }
  };

  document.getElementById("create-selected-btn").onclick = async () => {
    const rows = Array.from(listEl.querySelectorAll("[data-cand-id]"));
    let created = 0;
    for (const row of rows) {
      const checkbox = row.querySelector(".cand-select");
      if (!checkbox.checked) continue;
      const ok = await createFromRow(row);
      if (ok) { created++; await removeCandidateFromStorage(row.dataset.candId); }
    }
    toast(`${created} fiche(s) créée(s) ✓`);
    navigate("clients");
  };
}

async function renderDriveStatus() {
  const el = document.getElementById("drive-status");
  if (!el) return;
  const connected = await isDriveConnected();
  const lastBackup = await DB.getParam("lastCloudBackupAt", null);
  const lastError = await DB.getParam("lastCloudError", null);

  if (connected) await DB.setParam("driveConnected", true); // auto-réparation

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
    <h2>Importer cette sauvegarde</h2>
    <p style="color:var(--smoke);font-size:14px;margin:-6px 0 14px;">${escapeHtml(label || "")}</p>
    <button class="choice-tile" id="opt-merge">
      <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>
      <span>Ajouter à mes données actuelles<span class="sub">Complète et met à jour, ne supprime rien</span></span>
    </button>
    <button class="choice-tile" id="opt-snapshot">
      <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>
      <span>Restaurer comme instantané<span class="sub">Remplace tout : efface d'abord toutes les données actuelles</span></span>
    </button>
    <div class="sheet-actions">
      <button class="btn-secondary" id="cancel-btn" style="width:100%;">Annuler</button>
    </div>
  `);
  document.getElementById("cancel-btn").onclick = closeSheet;

  document.getElementById("opt-merge").onclick = async () => {
    closeSheet();
    toast("Import en cours…");
    const r = await runCloudImport(fileId);
    toast(r.ok ? "Import terminé ✓" : "Échec de l'import : " + r.error);
    render();
  };

  document.getElementById("opt-snapshot").onclick = () => confirmSnapshotRestore(fileId, label);
}

async function confirmSnapshotRestore(fileId, label) {
  openSheet(`
    <h2>⚠️ Remplacer toutes les données ?</h2>
    <p style="color:var(--smoke);font-size:14px;margin:-6px 0 4px;">${escapeHtml(label || "")}</p>
    <p style="color:var(--danger);font-size:14px;">Tous les clients, rendez-vous et interventions actuellement dans l'appli seront définitivement supprimés, puis remplacés uniquement par le contenu de cette sauvegarde. Cette action est irréversible (sauf à réimporter une sauvegarde plus récente ensuite).</p>
    <div class="sheet-actions">
      <button class="btn-secondary" id="cancel-btn">Annuler</button>
      <button class="btn-danger" id="confirm-btn">Tout remplacer</button>
    </div>
  `);
  document.getElementById("cancel-btn").onclick = closeSheet;
  document.getElementById("confirm-btn").onclick = async () => {
    closeSheet();
    toast("Suppression des données actuelles…");
    await DB.clearClients();
    await DB.clearRendezvous();
    await DB.clearInterventions();
    toast("Restauration en cours…");
    const r = await runCloudImport(fileId);
    toast(r.ok ? "Instantané restauré ✓" : "Échec de la restauration : " + r.error);
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
async function checkClientDuplicates(saved) {
  const all = await DB.listClients();
  const savedPhones = [saved.telephone, saved.telephone2].map((p) => (p || "").replace(/\D/g, "")).filter(Boolean);
  const savedName = clientFullName(saved).trim().toLowerCase();
  const phoneMatches = [];
  const nameMatches = [];
  for (const c of all) {
    if (c.id === saved.id) continue;
    const cPhones = [c.telephone, c.telephone2].map((p) => (p || "").replace(/\D/g, "")).filter(Boolean);
    if (savedPhones.some((p) => cPhones.includes(p))) phoneMatches.push(c);
    if (savedName && clientFullName(c).trim().toLowerCase() === savedName) nameMatches.push(c);
  }
  return { phoneMatches, nameMatches };
}

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
    <label class="chk" style="margin-top:12px;"><input type="checkbox" id="f-pastille" ${c.pastilleBleue ? "checked" : ""} /> Pastille bleue</label>
    <div class="form-row"><label>Téléphone</label><input type="tel" id="f-tel" value="${escapeAttr(c.telephone)}" /></div>
    <div class="form-row"><label>Téléphone secondaire (facultatif)</label><input type="tel" id="f-tel2" value="${escapeAttr(c.telephone2)}" /></div>
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
      pastilleBleue: document.getElementById("f-pastille").checked,
      telephone: document.getElementById("f-tel").value.trim(),
      telephone2: document.getElementById("f-tel2").value.trim(),
      email: document.getElementById("f-email").value.trim(),
      adresse: document.getElementById("f-adresse").value.trim(),
      marque: document.getElementById("f-marque").value.trim(),
      modele: document.getElementById("f-modele").value.trim(),
      infosComplementaires: document.getElementById("f-infos").value.trim(),
      commentaires: document.getElementById("f-comment").value.trim(),
    };
    const addressChanged = !existing || existing.adresse !== client.adresse;
    if (addressChanged) { client.lat = null; client.lon = null; client.geocodeStatus = null; }
    // "Client importé" n'est qu'un centre de tri temporaire : dès que la fiche est
    // modifiée (donc vérifiée), elle rejoint la liste normale des clients.
    if (existing && existing.source === "import") client.source = null;
    const saved = await DB.saveClient(client);
    closeSheet();

    const proceedAfterSave = () => {
      if (onSaved) {
        onSaved(saved);
      } else {
        toast(existing ? "Client mis à jour" : "Client créé");
        navigate("fiche", saved.id);
      }
    };

    const dup = await checkClientDuplicates(saved);
    if (dup.phoneMatches.length > 0) {
      openSheet(`
        <h2>⚠️ Numéro déjà utilisé</h2>
        <p style="color:var(--smoke);font-size:14px;">Ce numéro de téléphone est déjà associé à : <strong>${dup.phoneMatches.map((x) => escapeHtml(clientFullName(x))).join(", ")}</strong>. Vérifie qu'il ne s'agit pas d'un doublon.</p>
        <div class="sheet-actions"><button class="btn-primary" id="dup-ok-btn" style="width:100%;">Continuer</button></div>
      `);
      document.getElementById("dup-ok-btn").onclick = () => { closeSheet(); proceedAfterSave(); };
    } else {
      if (dup.nameMatches.length > 0) {
        toast(`ℹ️ Homonyme existant : ${dup.nameMatches.map((x) => clientFullName(x)).join(", ")}`);
      }
      proceedAfterSave();
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
async function renderNearbyHtml(clientId, dateISO, excludeRdvId, radiusKm, horizonMonths) {
  const controls = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="display:flex;flex-direction:column;gap:3px;">
          <button type="button" id="nearby-radius-up" style="width:32px;height:24px;border-radius:6px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);font-size:11px;">▲</button>
          <button type="button" id="nearby-radius-down" style="width:32px;height:24px;border-radius:6px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);font-size:11px;">▼</button>
        </div>
        <div id="nearby-radius-value" style="font-family:var(--font-mono);font-size:15px;font-weight:600;">${radiusKm} km</div>
      </div>
      <div class="pill-choice" id="nearby-months" style="flex:0 0 auto;">
        <button type="button" data-months="3" class="${horizonMonths === 3 ? "active period-active" : ""}" style="padding:8px 10px;">3 mois</button>
        <button type="button" data-months="6" class="${horizonMonths === 6 ? "active period-active" : ""}" style="padding:8px 10px;">6 mois</button>
        <button type="button" data-months="13" class="${horizonMonths === 13 ? "active period-active" : ""}" style="padding:8px 10px;">13 mois</button>
      </div>
    </div>
  `;
  const wrap = (inner) => `
    <div class="info-block" style="margin-top:2px;">
      <h3>Rendez-vous proches</h3>
      ${controls}
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
  end.setMonth(end.getMonth() + horizonMonths);
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
    .filter((x) => x && x.distKm <= radiusKm)
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, 5);

  if (withDist.length === 0) {
    return wrap(`<p class="near-hint">Aucun rendez-vous trouvé à moins de ${radiusKm} km dans les ${horizonMonths} prochains mois.</p>`);
  }
  return wrap(`
    <p class="near-hint" style="margin:0 0 6px;">Touche une date pour la reprendre pour ce rendez-vous.</p>
    <div class="near-list">
      ${withDist.map((x) => `<button type="button" class="near-item near-item-btn" data-copy-date="${x.date}"><span>${fmtDateFullFR(x.date)} — ${escapeHtml(x.name)}</span><span class="dist">${x.distKm.toFixed(1)} km</span></button>`).join("")}
    </div>
  `);
}

async function computeNearbyByPosition(coords, horizonDays, radiusKm = 20) {
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
    .filter((x) => x && x.distKm <= radiusKm)
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
        <div id="f-client-comment"></div>
        <div id="f-client-history"></div>
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
      <input type="text" id="f-sector-input" placeholder="Ville ou adresse (ex : Étretat)" style="width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;background:var(--surface);color:var(--ink);margin-bottom:10px;" />
      <div class="form-row" style="margin-bottom:10px;">
        <label>Rayon de recherche</label>
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="display:flex;flex-direction:column;gap:3px;">
            <button type="button" id="radius-up" style="width:36px;height:26px;border-radius:7px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);">▲</button>
            <button type="button" id="radius-down" style="width:36px;height:26px;border-radius:7px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);">▼</button>
          </div>
          <div id="radius-value" style="font-family:var(--font-mono);font-size:18px;font-weight:600;">5 km</div>
        </div>
      </div>
      <div class="pill-choice pill-3" id="geo-near-buttons">
        <button type="button" data-months="3">3 mois</button>
        <button type="button" data-months="6">6 mois</button>
        <button type="button" data-months="13">13 mois</button>
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
    selectedEl.innerHTML = c ? `<div class="client-picker-chip">${clientBadge(c)}${escapeHtml(clientFullName(c))}</div>` : `<div class="near-hint">Aucun client sélectionné</div>`;
    const commentEl = document.getElementById("f-client-comment");
    if (commentEl) {
      commentEl.innerHTML = (c && c.commentaires)
        ? `<p class="near-hint" style="margin:6px 0 0;">💬 ${escapeHtml(c.commentaires)}</p>`
        : "";
    }
    const historyEl = document.getElementById("f-client-history");
    if (historyEl) {
      if (!c) { historyEl.innerHTML = ""; }
      else {
        DB.listInterventionsForClient(c.id).then((hist) => {
          if (!hist.length) { historyEl.innerHTML = ""; return; }
          const sorted = hist.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
          historyEl.innerHTML = `
            <div class="near-hint" style="margin:8px 0 4px;">Historique chez ce client :</div>
            ${sorted.map((h) => `<div class="near-hint" style="margin:0 0 2px;">• ${fmtDateFR(h.date)} — ${h.type === "entretien" ? "Entretien" : "Dépannage"}</div>`).join("")}
          `;
        });
      }
    }
  }
  updateSelectedDisplay();

  searchInput.oninput = () => {
    const q = normalizeForMatch(searchInput.value.trim());
    if (!q) { resultsEl.innerHTML = ""; return; }
    const matches = clients.filter((c) => normalizeForMatch(clientFullName(c)).includes(q)).slice(0, 6);
    resultsEl.innerHTML = matches.length
      ? matches.map((c) => `<button type="button" class="client-picker-item" data-cid="${c.id}">
          <span class="cpi-name">${clientBadge(c)}${escapeHtml(clientFullName(c))}</span>
          ${c.adresse ? `<span class="cpi-detail">📍 ${escapeHtml(c.adresse)}</span>` : ""}
          ${c.telephone ? `<span class="cpi-detail">📞 ${escapeHtml(c.telephone)}</span>` : ""}
        </button>`).join("")
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
  let nearbyRadiusKm = 5;
  let nearbyHorizonMonths = 3;
  async function refreshNearby() {
    const dateVal = document.getElementById("f-date").value;
    nearContainer.innerHTML = await renderNearbyHtml(selectedClientId, dateVal, existing ? existing.id : null, nearbyRadiusKm, nearbyHorizonMonths);
    nearContainer.querySelectorAll("[data-copy-date]").forEach((el) => {
      el.onclick = () => {
        document.getElementById("f-date").value = el.dataset.copyDate;
        refreshNearby();
      };
    });
    const upBtn = document.getElementById("nearby-radius-up");
    const downBtn = document.getElementById("nearby-radius-down");
    if (upBtn) upBtn.onclick = () => { nearbyRadiusKm = Math.min(50, nearbyRadiusKm + 1); refreshNearby(); };
    if (downBtn) downBtn.onclick = () => { nearbyRadiusKm = Math.max(1, nearbyRadiusKm - 1); refreshNearby(); };
    nearContainer.querySelectorAll("#nearby-months button").forEach((b) => {
      b.onclick = () => { nearbyHorizonMonths = parseInt(b.dataset.months, 10); refreshNearby(); };
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
  let radiusKm = 5;
  const sectorInput = document.getElementById("f-sector-input");
  sectorInput.oninput = () => { sectorCoords = null; };

  const radiusValueEl = document.getElementById("radius-value");
  document.getElementById("radius-up").onclick = () => {
    radiusKm = Math.min(50, radiusKm + 1);
    radiusValueEl.textContent = `${radiusKm} km`;
  };
  document.getElementById("radius-down").onclick = () => {
    radiusKm = Math.max(1, radiusKm - 1);
    radiusValueEl.textContent = `${radiusKm} km`;
  };

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
      const months = parseInt(b.dataset.months, 10);
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + months);
      const horizonDays = Math.round((endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      const results = await computeNearbyByPosition(coords, horizonDays, radiusKm);
      const resultsEl = document.getElementById("geo-near-results");
      resultsEl.innerHTML = results.length
        ? `<div class="near-list">${results.map((x) => `<button type="button" class="near-item near-item-btn" data-copy-date-geo="${x.date}"><span>${fmtDateFullFR(x.date)} — ${escapeHtml(x.name)}</span><span class="dist">${x.distKm.toFixed(1)} km</span></button>`).join("")}</div>`
        : `<p class="near-hint">Aucun rendez-vous trouvé à moins de ${radiusKm} km sur cette période.</p>`;
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
    <h2>${client ? clientBadge(client) + escapeHtml(clientFullName(client)) : "Rendez-vous"}</h2>
    <p style="color:var(--smoke);font-size:13px;margin:-10px 0 4px;">${fmtDateFR(r.date)}${period ? " · " + period : ""} · ${r.type === "entretien" ? "Entretien" : "Dépannage"}${r.statut === "honore" ? " · <span style=\"color:var(--moss);font-weight:600;\">✓ Honoré</span>" : ""}</p>
    ${addr ? `<p style="font-size:13.5px;color:var(--ink-dim);margin:0 0 4px;">📍 ${escapeHtml(addr)}</p>` : ""}
    ${client && client.commentaires ? `<p style="font-size:13.5px;color:var(--ember);background:var(--ember-wash);border-radius:9px;padding:9px 11px;margin:6px 0;">⚠️ ${escapeHtml(client.commentaires)}</p>` : ""}
    ${r.statut === "honore" ? `<p style="font-size:13.5px;color:var(--ink-dim);margin:0 0 4px;">📝 ${(r.paiement ? formatPaiementLines(r.paiement) : (r.compteRenduHonore ? [r.compteRenduHonore] : ["⚠️ Paiement non renseigné"])).map(escapeHtml).join(" — ")}</p>` : (r.commentaire ? `<p style="font-size:13.5px;color:var(--ink-dim);margin:0 0 4px;">${escapeHtml(r.commentaire)}</p>` : "")}

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
  let mode = (r.paiement && r.paiement.mode) || "cheque";
  let cheques = (r.paiement && r.paiement.mode === "cheque" && r.paiement.cheques && r.paiement.cheques.length)
    ? r.paiement.cheques.map((c) => ({ ...c }))
    : [{ numero: "", montant: "", commentaire: "" }];
  let virement = (r.paiement && r.paiement.mode === "virement")
    ? { montant: r.paiement.montant || "", commentaire: r.paiement.commentaire || "" }
    : { montant: "", commentaire: "" };
  let honorePhotos = [];

  openSheet(`
    <h2>RDV honoré</h2>
    <p style="color:var(--smoke);font-size:13px;margin:-8px 0 14px;">${client ? clientBadge(client) + escapeHtml(clientFullName(client)) : ""} — ${fmtDateFR(r.date)}</p>
    <p style="font-size:13.5px;color:var(--ink-dim);margin:0 0 14px;">Ce rendez-vous sera ajouté à l'historique du client.</p>
    <div class="form-row">
      <label>Mode de paiement</label>
      <div class="pill-choice" id="f-paiement-mode">
        <button type="button" data-val="cheque" class="${mode === "cheque" ? "active period-active" : ""}">Chèque</button>
        <button type="button" data-val="virement" class="${mode === "virement" ? "active period-active" : ""}">Virement bancaire</button>
      </div>
    </div>
    <div id="paiement-details"></div>
    <div class="form-row">
      <label>Photos (facultatif)</label>
      <div id="honore-photos-grid"></div>
      <input type="file" accept="image/*" capture="environment" multiple id="honore-photo-input" hidden />
      <button type="button" class="btn-secondary" id="honore-photo-add-btn" style="width:100%;margin-top:8px;">+ Ajouter une photo</button>
    </div>
    <div class="sheet-actions">
      <button class="btn-secondary" id="cancel-btn">Annuler</button>
      <button class="btn-primary" id="confirm-btn">Valider</button>
    </div>
  `);

  const detailsEl = document.getElementById("paiement-details");

  function readChequesFromDOM() {
    cheques = cheques.map((_, i) => ({
      numero: (document.getElementById(`f-cheque-numero-${i}`) || {}).value || "",
      montant: (document.getElementById(`f-cheque-montant-${i}`) || {}).value || "",
      commentaire: (document.getElementById(`f-cheque-comment-${i}`) || {}).value || "",
    }));
  }
  function readVirementFromDOM() {
    const m = document.getElementById("f-virement-montant");
    const c = document.getElementById("f-virement-comment");
    if (m) virement.montant = m.value;
    if (c) virement.commentaire = c.value;
  }

  function renderDetails() {
    if (mode === "cheque") {
      detailsEl.innerHTML = `
        <div class="form-row">
          <label>Nombre de chèques</label>
          <input type="number" id="f-nb-cheques" min="1" max="6" value="${cheques.length}" />
        </div>
        <div id="cheques-list"></div>
      `;
      renderChequesList();
      document.getElementById("f-nb-cheques").onchange = (e) => {
        readChequesFromDOM();
        let n = parseInt(e.target.value, 10);
        if (!n || n < 1) n = 1;
        if (n > 6) n = 6;
        while (cheques.length < n) cheques.push({ numero: "", montant: "", commentaire: "" });
        cheques = cheques.slice(0, n);
        renderChequesList();
      };
    } else {
      detailsEl.innerHTML = `
        <div class="form-row"><label>Montant du virement (€)</label><input type="text" inputmode="decimal" id="f-virement-montant" value="${escapeAttr(virement.montant)}" /></div>
        <div class="form-row"><label>Commentaire (facultatif)</label><input type="text" id="f-virement-comment" value="${escapeAttr(virement.commentaire)}" /></div>
      `;
    }
  }

  function renderChequesList() {
    const listEl = document.getElementById("cheques-list");
    listEl.innerHTML = cheques.map((c, i) => `
      <div class="info-block" style="margin-top:8px;">
        <h3>Chèque ${i + 1}</h3>
        <div class="form-row"><label>Numéro</label><input type="text" inputmode="numeric" id="f-cheque-numero-${i}" value="${escapeAttr(c.numero)}" /></div>
        <div class="form-row"><label>Montant (€)</label><input type="text" inputmode="decimal" id="f-cheque-montant-${i}" value="${escapeAttr(c.montant)}" /></div>
        <div class="form-row"><label>Commentaire (facultatif)</label><input type="text" id="f-cheque-comment-${i}" value="${escapeAttr(c.commentaire)}" /></div>
      </div>
    `).join("");
  }

  renderDetails();

  function renderHonorePhotosGrid() {
    document.getElementById("honore-photos-grid").innerHTML = photoGridHtml(honorePhotos, true);
    document.querySelectorAll("#honore-photos-grid .photo-remove").forEach((btn) => {
      btn.onclick = () => {
        honorePhotos = honorePhotos.filter((_, i) => i !== parseInt(btn.dataset.idx, 10));
        renderHonorePhotosGrid();
      };
    });
  }
  document.getElementById("honore-photo-add-btn").onclick = () => document.getElementById("honore-photo-input").click();
  document.getElementById("honore-photo-input").onchange = async (e) => {
    const newPhotos = await resizeImageFilesToDataURLs(e.target.files);
    honorePhotos = [...honorePhotos, ...newPhotos];
    renderHonorePhotosGrid();
  };

  document.querySelectorAll("#f-paiement-mode button").forEach((b) => {
    b.onclick = () => {
      if (mode === "cheque") readChequesFromDOM(); else readVirementFromDOM();
      mode = b.dataset.val;
      document.querySelectorAll("#f-paiement-mode button").forEach((x) => x.classList.remove("active", "period-active"));
      b.classList.add("active", "period-active");
      renderDetails();
    };
  });

  document.getElementById("cancel-btn").onclick = closeSheet;
  document.getElementById("confirm-btn").onclick = async () => {
    let paiement;
    if (mode === "cheque") {
      readChequesFromDOM();
      paiement = { mode: "cheque", cheques: cheques.map((c) => ({ numero: c.numero.trim(), montant: c.montant.trim(), commentaire: c.commentaire.trim() })) };
    } else {
      readVirementFromDOM();
      paiement = { mode: "virement", montant: virement.montant.trim(), commentaire: virement.commentaire.trim() };
    }

    await DB.saveIntervention({
      clientId: r.clientId,
      date: r.date,
      type: r.type,
      description: formatPaiementLines(paiement).join(" / "),
      photos: honorePhotos,
    });
    r.statut = "honore";
    r.paiement = paiement;
    // On fige ici le statut "nouveau client" tel qu'il était au moment de CE rendez-vous —
    // le récapitulatif s'appuiera toujours sur cette valeur figée, jamais sur l'état
    // actuel de la fiche (qui, lui, bascule juste après pour les prochaines fois).
    r.etaitNouveauClient = !!(client && client.nouveauClient === "oui");
    await DB.saveRendezvous(r);

    // Bascule automatique en client existant, pour les rendez-vous SUIVANTS uniquement.
    if (client && client.nouveauClient === "oui") {
      const freshClient = await DB.getClient(client.id);
      if (freshClient) {
        freshClient.nouveauClient = "non";
        await DB.saveClient(freshClient);
      }
    }

    closeSheet();
    toast("Rendez-vous honoré, ajouté à l'historique");
    navigate("agenda");
  };
}

function formatPaiementLines(paiement) {
  if (!paiement) return ["⚠️ Paiement non renseigné"];
  if (paiement.mode === "virement") {
    const montant = paiement.montant ? `${paiement.montant}€` : "—";
    return [`Virement bancaire — ${montant}${paiement.commentaire ? " — " + paiement.commentaire : ""}`];
  }
  const cheques = paiement.cheques || [];
  if (cheques.length === 0) return ["⚠️ Paiement non renseigné"];
  if (cheques.length === 1) {
    const c = cheques[0];
    return [
      `Numéro de chèque : ${c.numero || "—"}`,
      `Montant : ${c.montant ? c.montant + "€" : "—"}${c.commentaire ? " — " + c.commentaire : ""}`,
    ];
  }
  return cheques.map((c, i) => `Chèque ${i + 1} — Numéro : ${c.numero || "—"} / Montant : ${c.montant ? c.montant + "€" : "—"}${c.commentaire ? " — " + c.commentaire : ""}`);
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

// ---------- Photos (redimensionnement avant stockage) ----------
// Les photos sont stockées en base64 directement sur les fiches client/intervention,
// ce qui les inclut automatiquement dans la sauvegarde Drive comme le reste des
// données — mais ça veut dire qu'il faut les compresser en amont pour ne pas
// alourdir démesurément les sauvegardes.
function resizeImageToDataURL(file, maxDim = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image invalide"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function resizeImageFilesToDataURLs(fileList) {
  const files = Array.from(fileList || []);
  const results = [];
  for (const f of files) {
    try { results.push(await resizeImageToDataURL(f)); } catch (e) { /* fichier ignoré si illisible */ }
  }
  return results;
}

function photoGridHtml(photos, removable) {
  if (!photos || photos.length === 0) return "";
  return `<div class="photo-grid">${photos.map((src, i) => `
    <div class="photo-thumb">
      <img src="${src}" alt="" />
      ${removable ? `<button type="button" class="photo-remove" data-idx="${i}" aria-label="Supprimer">×</button>` : ""}
    </div>
  `).join("")}</div>`;
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
async function migratePeriodeNonPrecisee() {
  const done = await DB.getParam("migrationPeriodeApresmidi", false);
  if (done) return;
  const all = await DB.listRendezvous();
  for (const r of all) {
    if (!r.periode) {
      r.periode = "apres-midi";
      await DB.saveRendezvous(r);
    }
  }
  await DB.setParam("migrationPeriodeApresmidi", true);
  if (state.view === "agenda") refreshAgendaBody();
}

history.replaceState(historySnapshot(), "", "#accueil");
render();
maybeAutoCloudBackup();
maybeAutoCalendarSync();
maybeFridayReminder();
maybeStaleCalendarWarning();
migratePeriodeNonPrecisee();
