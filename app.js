/* app.js — SPA légère, sans framework, 100% locale.
   Vues : Agenda / Clients / Fiche client / Réglages
   Toute la donnée passe par DB (db.js → IndexedDB). */

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

const state = {
  view: "agenda",
  weekStart: startOfWeek(new Date()),
  clientId: null,
  clientSearch: "",
};

// ---------- Utilitaires date ----------
function startOfWeek(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // lundi = 0
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function toISO(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function isSameDay(a, b) { return toISO(a) === toISO(b); }
function fmtShort(d) { return `${d.getDate()} ${MOIS[d.getMonth()]}`; }
function fmtDateFR(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MOIS[m - 1]} ${y}`;
}

// ---------- Rendu racine ----------
const root = document.getElementById("view-root");
const title = document.getElementById("page-title");
const btnToday = document.getElementById("btn-today");

async function render() {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === state.view || (state.view === "fiche" && b.dataset.view === "clients"));
  });
  btnToday.hidden = state.view !== "agenda";

  if (state.view === "agenda") { title.textContent = "Agenda"; await renderAgenda(); }
  else if (state.view === "clients") { title.textContent = "Clients"; await renderClients(); }
  else if (state.view === "fiche") { await renderFiche(); }
  else if (state.view === "reglages") { title.textContent = "Réglages"; await renderReglages(); }

  root.scrollTop = 0;
}

// ---------- Vue Agenda ----------
async function renderAgenda() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
  const startISO = toISO(days[0]), endISO = toISO(days[6]);
  const rdvs = await DB.listRendezvousRange(startISO, endISO);
  const byDate = {};
  rdvs.forEach((r) => { (byDate[r.date] ||= []).push(r); });

  const clients = await DB.listClients();
  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));

  const today = new Date();
  const weekEnd = addDays(state.weekStart, 6);

  let html = `
    <div class="week-nav">
      <button id="week-prev" aria-label="Semaine précédente">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <span class="week-label">${fmtShort(days[0])} — ${fmtShort(days[6])}</span>
      <button id="week-next" aria-label="Semaine suivante">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  `;

  for (const d of days) {
    const iso = toISO(d);
    const isToday = isSameDay(d, today);
    const dayRdvs = byDate[iso] || [];
    const matin = dayRdvs.filter((r) => r.periode === "matin");
    const apresmidi = dayRdvs.filter((r) => r.periode === "apres-midi");

    html += `<div class="day-card ${isToday ? "is-today" : ""}">
      <div class="day-head">
        <span class="dow">${JOURS[(d.getDay() + 6) % 7]}</span>
        <span class="ddate">${fmtShort(d)}</span>
        ${isToday ? '<span class="today-pill">Aujourd\'hui</span>' : ""}
      </div>
      <div class="periods">
        ${renderPeriod("matin", "Matin", matin, clientMap, iso)}
        ${renderPeriod("apres-midi", "Après-midi", apresmidi, clientMap, iso)}
      </div>
      ${dayRdvs.length >= 2 ? `<button class="optimize-bar" data-optimize="${iso}">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2c1 3-1 4-1 6 0 1.2 1 2 2 2 1.3 0 2-1 2-2.2 1.6 1.4 3 3.7 3 6.2a6 6 0 0 1-12 0c0-2.6 1.1-4.3 2.3-6C9.2 6.3 10.5 4.4 12 2Z"/></svg>
        Optimiser le trajet (${dayRdvs.length} clients)
      </button>` : ""}
    </div>`;
  }

  root.innerHTML = html;

  document.getElementById("week-prev").onclick = () => { state.weekStart = addDays(state.weekStart, -7); render(); };
  document.getElementById("week-next").onclick = () => { state.weekStart = addDays(state.weekStart, 7); render(); };
  btnToday.onclick = () => { state.weekStart = startOfWeek(new Date()); render(); };

  root.querySelectorAll(".slot[data-rdv]").forEach((el) => {
    el.onclick = () => openRdvDetail(el.dataset.rdv);
  });
  root.querySelectorAll(".add-slot-btn").forEach((el) => {
    el.onclick = () => openRdvForm({ date: el.dataset.date, periode: el.dataset.periode });
  });
  root.querySelectorAll("[data-optimize]").forEach((el) => {
    el.onclick = () => toast("Optimisation du trajet : disponible avec le géocodage (prochaine étape) 🧭");
  });
}

function renderPeriod(key, label, list, clientMap, iso) {
  let inner = "";
  if (list.length === 0) {
    inner = `<div class="slot-empty">—</div>`;
  } else {
    inner = list.map((r) => {
      const c = clientMap[r.clientId];
      const typeClass = r.type === "entretien" ? "type-entretien" : "type-depannage";
      return `<button class="slot ${typeClass}" data-rdv="${r.id}">
        <span class="slot-name">${escapeHtml(c ? `${c.prenom} ${c.nom}` : "Client supprimé")}</span>
        <span class="slot-type">${r.type === "entretien" ? "Entretien" : "Dépannage"}</span>
      </button>`;
    }).join("");
  }
  return `<div class="period">
    <div class="period-label">${label}</div>
    ${inner}
    <button class="add-slot-btn" data-date="${iso}" data-periode="${key}">+ Ajouter</button>
  </div>`;
}

// ---------- Vue Clients ----------
async function renderClients() {
  const clients = await DB.searchClients(state.clientSearch);
  let html = `<input type="text" class="search-bar" id="client-search" placeholder="Rechercher un client (nom, adresse, téléphone)" value="${escapeHtml(state.clientSearch)}" />`;

  if (clients.length === 0) {
    html += `<div class="empty-state"><span class="emoji">🔍</span>${state.clientSearch ? "Aucun client trouvé." : "Aucun client pour l'instant.<br>Ajoute ton premier client avec le bouton +."}</div>`;
  } else {
    html += clients.map((c) => `
      <button class="client-row" data-client="${c.id}">
        <span class="client-avatar">${initials(c)}</span>
        <span>
          <span class="cname">${escapeHtml(c.prenom)} ${escapeHtml(c.nom)}</span>
          <span class="caddr">${escapeHtml(c.adresse || "Adresse non renseignée")}</span>
        </span>
        <span class="chevron">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </button>`).join("");
  }

  root.innerHTML = html;
  const input = document.getElementById("client-search");
  input.oninput = () => { state.clientSearch = input.value; renderClientsListOnly(); };
  input.focus();
  root.querySelectorAll("[data-client]").forEach((el) => {
    el.onclick = () => { state.clientId = el.dataset.client; state.view = "fiche"; render(); };
  });
}

async function renderClientsListOnly() {
  // ré-affiche juste la liste sans perdre le focus de la recherche
  const clients = await DB.searchClients(state.clientSearch);
  const container = document.createElement("div");
  if (clients.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="emoji">🔍</span>${state.clientSearch ? "Aucun client trouvé." : "Aucun client pour l'instant."}</div>`;
  } else {
    container.innerHTML = clients.map((c) => `
      <button class="client-row" data-client="${c.id}">
        <span class="client-avatar">${initials(c)}</span>
        <span>
          <span class="cname">${escapeHtml(c.prenom)} ${escapeHtml(c.nom)}</span>
          <span class="caddr">${escapeHtml(c.adresse || "Adresse non renseignée")}</span>
        </span>
        <span class="chevron">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </button>`).join("");
  }
  const old = root.querySelectorAll(".client-row, .empty-state");
  old.forEach((n) => n.remove());
  root.append(...container.childNodes);
  root.querySelectorAll("[data-client]").forEach((el) => {
    el.onclick = () => { state.clientId = el.dataset.client; state.view = "fiche"; render(); };
  });
}

function initials(c) {
  return ((c.prenom || "?")[0] + (c.nom || "?")[0]).toUpperCase();
}

// ---------- Fiche client ----------
async function renderFiche() {
  const c = await DB.getClient(state.clientId);
  if (!c) { state.view = "clients"; return render(); }
  title.textContent = `${c.prenom} ${c.nom}`;

  const historique = await DB.listInterventionsForClient(c.id);
  const mapsUrl = c.adresse ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.adresse)}` : null;
  const telHref = c.telephone ? `tel:${c.telephone.replace(/\s+/g, "")}` : null;
  const smsBody = encodeURIComponent(`Bonjour ${c.prenom}, je suis en route pour notre rendez-vous. À tout de suite.`);
  const smsHref = c.telephone ? `sms:${c.telephone.replace(/\s+/g, "")}?body=${smsBody}` : null;

  root.innerHTML = `
    <button class="back-row" id="back-btn">
      <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Clients
    </button>
    <div class="fiche-head">
      <p class="fname">${escapeHtml(c.prenom)} ${escapeHtml(c.nom)}</p>
      <p class="faddr">${escapeHtml(c.adresse || "Adresse non renseignée")}</p>
    </div>

    <div class="quick-actions">
      <a class="qa-btn" href="${mapsUrl || "#"}" target="_blank" rel="noopener" ${mapsUrl ? "" : "aria-disabled=\"true\""}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>
        Itinéraire
      </a>
      <a class="qa-btn" href="${telHref || "#"}" ${telHref ? "" : "aria-disabled=\"true\""}>
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6.6 10.8c1.4 2.7 3.6 4.9 6.3 6.3l2.1-2.1c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1L6.6 10.8z"/></svg>
        Appeler
      </a>
      <a class="qa-btn" href="${smsHref || "#"}" ${smsHref ? "" : "aria-disabled=\"true\""}>
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
      <div class="info-row"><span class="k">Matériel</span><span class="v">${escapeHtml(labelMateriel(c.materielType) || "—")}</span></div>
      <div class="info-row"><span class="k">Marque</span><span class="v">${escapeHtml(c.marque || "—")}</span></div>
      <div class="info-row"><span class="k">Modèle</span><span class="v">${escapeHtml(c.modele || "—")}</span></div>
      ${c.infosComplementaires ? `<div class="info-row"><span class="k">Infos</span><span class="v">${escapeHtml(c.infosComplementaires)}</span></div>` : ""}
    </div>

    <div class="info-block">
      <h3>Coordonnées</h3>
      <div class="info-row"><span class="k">Téléphone</span><span class="v">${escapeHtml(c.telephone || "—")}</span></div>
      ${c.email ? `<div class="info-row"><span class="k">E-mail</span><span class="v">${escapeHtml(c.email)}</span></div>` : ""}
    </div>

    ${c.commentaires ? `<div class="info-block"><h3>Commentaires</h3><p class="comment-text">${escapeHtml(c.commentaires)}</p></div>` : ""}

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

  document.getElementById("back-btn").onclick = () => { state.view = "clients"; render(); };
  document.getElementById("qa-rdv").onclick = () => openRdvForm({ clientId: c.id });
  document.getElementById("edit-client-btn").onclick = () => openClientForm(c);
  document.getElementById("del-client-btn").onclick = () => confirmDeleteClient(c);

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

function labelMateriel(v) {
  const map = { bois: "Poêle à bois", granules: "Poêle à granulés", autre: "Autre" };
  return map[v] || v;
}

// ---------- Réglages ----------
async function renderReglages() {
  const depart = (await DB.getParam("pointDepart", "")) || "";
  root.innerHTML = `
    <div class="info-block">
      <h3>Point de départ</h3>
      <div class="form-row" style="margin-bottom:8px;">
        <label for="depart-input">Domicile / atelier</label>
        <input type="text" id="depart-input" value="${escapeHtml(depart)}" placeholder="Adresse de départ pour les tournées" />
      </div>
      <button class="btn-primary" id="save-depart" style="width:100%;">Enregistrer</button>
    </div>

    <div class="info-block">
      <h3>Sauvegarde locale</h3>
      <p style="font-size:13.5px;color:var(--smoke);margin:0 0 12px;">Exporte toutes les données (clients, rendez-vous, interventions) dans un fichier que tu peux garder de côté, en attendant la sauvegarde cloud automatique.</p>
      <div class="sheet-actions" style="margin-top:0;">
        <button class="btn-secondary" id="export-btn">Exporter</button>
        <button class="btn-secondary" id="import-btn">Importer</button>
      </div>
      <input type="file" id="import-file" accept="application/json" hidden />
    </div>

    <div class="info-block">
      <h3>À venir</h3>
      <p style="font-size:13.5px;color:var(--smoke);line-height:1.5;margin:0;">
        Géocodage automatique des adresses, rendez-vous proches suggérés, optimisation du trajet du jour, et sauvegarde automatique sur le cloud.
      </p>
    </div>
  `;

  document.getElementById("save-depart").onclick = async () => {
    await DB.setParam("pointDepart", document.getElementById("depart-input").value.trim());
    toast("Point de départ enregistré");
  };

  document.getElementById("export-btn").onclick = async () => {
    const data = {
      clients: await DB.listClients(),
      rendezvous: await DB.listRendezvous(),
      interventions: (await Promise.all((await DB.listClients()).map((c) => DB.listInterventionsForClient(c.id)))).flat(),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tournees-poeles-${toISO(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fileInput = document.getElementById("import-file");
  document.getElementById("import-btn").onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      for (const c of data.clients || []) await DB.saveClient(c);
      for (const r of data.rendezvous || []) await DB.saveRendezvous(r);
      for (const i of data.interventions || []) await DB.saveIntervention(i);
      toast("Import terminé ✓");
      render();
    } catch (e) {
      toast("Fichier invalide");
    }
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
async function openClientForm(existing) {
  const c = existing || {};
  openSheet(`
    <h2>${existing ? "Modifier le client" : "Nouveau client"}</h2>
    <div class="form-row-2">
      <div class="form-row"><label>Prénom</label><input type="text" id="f-prenom" value="${escapeAttr(c.prenom)}" /></div>
      <div class="form-row"><label>Nom</label><input type="text" id="f-nom" value="${escapeAttr(c.nom)}" /></div>
    </div>
    <div class="form-row"><label>Téléphone</label><input type="tel" id="f-tel" value="${escapeAttr(c.telephone)}" /></div>
    <div class="form-row"><label>E-mail (facultatif)</label><input type="email" id="f-email" value="${escapeAttr(c.email)}" /></div>
    <div class="form-row"><label>Adresse</label><input type="text" id="f-adresse" value="${escapeAttr(c.adresse)}" /></div>
    <div class="form-row">
      <label>Type de matériel</label>
      <select id="f-materiel">
        <option value="bois" ${c.materielType === "bois" ? "selected" : ""}>Poêle à bois</option>
        <option value="granules" ${c.materielType === "granules" ? "selected" : ""}>Poêle à granulés</option>
        <option value="autre" ${c.materielType === "autre" ? "selected" : ""}>Autre</option>
      </select>
    </div>
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
  document.getElementById("save-btn").onclick = async () => {
    const prenom = document.getElementById("f-prenom").value.trim();
    const nom = document.getElementById("f-nom").value.trim();
    if (!prenom || !nom) { toast("Le nom et le prénom sont requis"); return; }
    const client = {
      ...c,
      prenom, nom,
      telephone: document.getElementById("f-tel").value.trim(),
      email: document.getElementById("f-email").value.trim(),
      adresse: document.getElementById("f-adresse").value.trim(),
      materielType: document.getElementById("f-materiel").value,
      marque: document.getElementById("f-marque").value.trim(),
      modele: document.getElementById("f-modele").value.trim(),
      infosComplementaires: document.getElementById("f-infos").value.trim(),
      commentaires: document.getElementById("f-comment").value.trim(),
    };
    const saved = await DB.saveClient(client);
    closeSheet();
    toast(existing ? "Client mis à jour" : "Client créé");
    state.clientId = saved.id;
    state.view = "fiche";
    render();
  };
}

async function confirmDeleteClient(c) {
  openSheet(`
    <h2>Supprimer ${escapeHtml(c.prenom)} ${escapeHtml(c.nom)} ?</h2>
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
    state.view = "clients";
    render();
  };
}

// ---------- Formulaire rendez-vous ----------
async function openRdvForm(prefill = {}, existing) {
  const clients = await DB.listClients();
  if (clients.length === 0) {
    toast("Ajoute d'abord un client");
    return openClientForm();
  }
  const r = existing || {};
  const clientId = r.clientId || prefill.clientId || clients[0].id;
  const date = r.date || prefill.date || toISO(new Date());
  const periode = r.periode || prefill.periode || "matin";
  const type = r.type || "entretien";

  openSheet(`
    <h2>${existing ? "Modifier le rendez-vous" : "Nouveau rendez-vous"}</h2>
    <div class="form-row">
      <label>Client</label>
      <select id="f-client">
        ${clients.map((c) => `<option value="${c.id}" ${c.id === clientId ? "selected" : ""}>${escapeHtml(c.prenom)} ${escapeHtml(c.nom)}</option>`).join("")}
      </select>
    </div>
    <div class="form-row"><label>Date</label><input type="date" id="f-date" value="${date}" /></div>
    <div class="form-row">
      <label>Période</label>
      <div class="pill-choice" id="f-periode">
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
    <div class="sheet-actions">
      <button class="btn-secondary" id="cancel-btn">Annuler</button>
      <button class="btn-primary" id="save-btn">Enregistrer</button>
    </div>
    ${existing ? `<button class="btn-danger" id="del-btn" style="width:100%;margin-top:10px;">Supprimer le rendez-vous</button>` : ""}
  `);

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
    const client = clients.find((c) => c.id === document.getElementById("f-client").value);
    const item = {
      ...r,
      clientId: client.id,
      date: document.getElementById("f-date").value,
      periode: selPeriode,
      type: selType,
      adresse: client.adresse,
      commentaire: document.getElementById("f-comment").value.trim(),
    };
    await DB.saveRendezvous(item);
    closeSheet();
    toast(existing ? "Rendez-vous mis à jour" : "Rendez-vous créé");
    render();
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

async function openRdvDetail(id) {
  const r = await DB.getRendezvous(id);
  if (!r) return;
  openRdvForm({}, r);
}

// ---------- Formulaire intervention ----------
async function openInterventionClientPicker() {
  const clients = await DB.listClients();
  if (clients.length === 0) { toast("Ajoute d'abord un client"); return openClientForm(); }
  openSheet(`
    <h2>Pour quel client ?</h2>
    <div class="form-row">
      <select id="f-client-pick" style="width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;">
        ${clients.map((c) => `<option value="${c.id}">${escapeHtml(c.prenom)} ${escapeHtml(c.nom)}</option>`).join("")}
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
    <p style="color:var(--smoke);font-size:13px;margin:-8px 0 14px;">${escapeHtml(client.prenom)} ${escapeHtml(client.nom)}</p>
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
    state.clientId = client.id;
    state.view = "fiche";
    render();
  };
}

// ---------- Navigation onglets ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.onclick = () => { state.view = btn.dataset.view; render(); };
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
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// ---------- Démarrage ----------
render();
