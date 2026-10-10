// PWA Service Worker — offline-first for GitHub Pages (no backend).
// Strategy: precache app shell + data on install; cache-first for images and
// same-origin assets; network-first for navigations with offline fallback.
const CACHE = 'char-games-v1';
const CORE = [
  'index.html', 'draft.html', 'deal.html', 'packs.html', 'guess.html', 'offline.html',
  'style.css', 'theme.css', 'guess.css', 'packs.css', 'deal.css',
  'common.js', 'app.js', 'deal.js', 'packs.js', 'guess.js',
  'characters.json', 'characters-ml.json', 'players-football.json', 'guess-hints.json',
  'characters-abilities.json', 'ml-abilities.json', 'football-abilities.json',
  'manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigations: try network, fall back to cache, then offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('offline.html')))
    );
    return;
  }

  // Images (incl. cross-origin CDNs): cache-first.
  if (req.destination === 'image') {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // Same-origin assets/data: cache-first with network refill.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
