/* db.js — accès à la base locale IndexedDB.
   Toute la donnée métier vit ici, sur le téléphone. Aucun appel réseau. */

const DB_NAME = "tournees-poeles";
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains("clients")) {
        const clients = db.createObjectStore("clients", { keyPath: "id" });
        clients.createIndex("nom", "nom", { unique: false });
      }

      if (!db.objectStoreNames.contains("interventions")) {
        const interventions = db.createObjectStore("interventions", { keyPath: "id" });
        interventions.createIndex("clientId", "clientId", { unique: false });
        interventions.createIndex("date", "date", { unique: false });
      }

      if (!db.objectStoreNames.contains("rendezvous")) {
        const rdv = db.createObjectStore("rendezvous", { keyPath: "id" });
        rdv.createIndex("clientId", "clientId", { unique: false });
        rdv.createIndex("date", "date", { unique: false });
      }

      if (!db.objectStoreNames.contains("parametres")) {
        db.createObjectStore("parametres", { keyPath: "cle" });
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function tx(storeName, mode = "readonly") {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  // ---- Clients ----
  async listClients() {
    const store = await tx("clients");
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr"));
  },
  async getClient(id) {
    const store = await tx("clients");
    return reqToPromise(store.get(id));
  },
  async saveClient(client) {
    if (!client.id) client.id = uid();
    client.updatedAt = Date.now();
    const store = await tx("clients", "readwrite");
    await reqToPromise(store.put(client));
    return client;
  },
  async deleteClient(id) {
    const store = await tx("clients", "readwrite");
    return reqToPromise(store.delete(id));
  },
  async clearClients() {
    const store = await tx("clients", "readwrite");
    return reqToPromise(store.clear());
  },
  async searchClients(query) {
    const all = await this.listClients();
    const q = (query || "").trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) => {
      const hay = [c.nom, c.prenom, c.adresse, c.telephone].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  },

  // ---- Interventions ----
  async listInterventionsForClient(clientId) {
    const store = await tx("interventions");
    const idx = store.index("clientId");
    const all = await reqToPromise(idx.getAll(clientId));
    return all.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  },
  async saveIntervention(item) {
    if (!item.id) item.id = uid();
    const store = await tx("interventions", "readwrite");
    await reqToPromise(store.put(item));
    return item;
  },
  async deleteIntervention(id) {
    const store = await tx("interventions", "readwrite");
    return reqToPromise(store.delete(id));
  },
  async clearInterventions() {
    const store = await tx("interventions", "readwrite");
    return reqToPromise(store.clear());
  },

  // ---- Rendez-vous ----
  async listRendezvous() {
    const store = await tx("rendezvous");
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  },
  async listRendezvousRange(startISO, endISO) {
    const all = await this.listRendezvous();
    return all.filter((r) => r.date >= startISO && r.date <= endISO);
  },
  async getRendezvous(id) {
    const store = await tx("rendezvous");
    return reqToPromise(store.get(id));
  },
  async saveRendezvous(item) {
    if (!item.id) item.id = uid();
    const store = await tx("rendezvous", "readwrite");
    await reqToPromise(store.put(item));
    return item;
  },
  async deleteRendezvous(id) {
    const store = await tx("rendezvous", "readwrite");
    return reqToPromise(store.delete(id));
  },
  async clearRendezvous() {
    const store = await tx("rendezvous", "readwrite");
    return reqToPromise(store.clear());
  },

  // ---- Paramètres (point de départ, etc.) ----
  async getParam(cle, defaut = null) {
    const store = await tx("parametres");
    const res = await reqToPromise(store.get(cle));
    return res ? res.valeur : defaut;
  },
  async setParam(cle, valeur) {
    const store = await tx("parametres", "readwrite");
    return reqToPromise(store.put({ cle, valeur }));
  },
};
