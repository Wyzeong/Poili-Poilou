const CACHE_NAME = "tournees-poeles-v1.56.1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./db.js",
  "./geo.js",
  "./drive.js",
  "./calendar.js",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache: "reload" : on récupère les fichiers sur le réseau, jamais depuis le cache HTTP du navigateur
      Promise.all(APP_SHELL.map((u) => fetch(new Request(u, { cache: "reload" })).then((res) => { if (!res.ok) throw new Error(u); return cache.put(u, res); })))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Cache-first pour l'app shell : l'appli s'affiche instantanément, même hors ligne.
// Toute requête réseau externe (géocodage, OSRM...) passe simplement au réseau
// et n'est jamais bloquée par le service worker.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // laisser passer les appels externes

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
