// Service worker : l'app fonctionne hors-ligne, les artworks vus sont gardés en cache.
const APP = 'duelpacks-app-v12';
const IMG = 'duelpacks-img-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'engine.js', 'state.js', 'data.js', 'cardback.png',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  // allSettled : un fichier manquant (ex. une icône pas encore envoyée) ne bloque pas l'installation
  e.waitUntil(caches.open(APP).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== APP && k !== IMG).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'images.ygoprodeck.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com') {
    e.respondWith(
      caches.open(IMG).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok || res.type === 'opaque') c.put(req, res.clone());
          return res;
        } catch { return hit || Response.error(); }
      }),
    );
    return;
  }
  if (url.origin === location.origin) {
    // réseau d'abord (mises à jour), cache en secours (hors-ligne)
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(APP).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))),
    );
  }
});
