// Splendor Duel service worker: offline shell only.
// Network-first for pages, scripts and styles; cached copies are the offline fallback.
// Never touches GameSync (different path and origin-scope) or cross-origin requests.
const CACHE = 'splendor-duel-shell-v3';
const SHELL = [
  './',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'assets/app.js',
  'assets/app.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
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
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL('./', self.location.href).pathname)) return;

  if (req.mode === 'navigate' || req.destination === 'script' || req.destination === 'style') {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(async (res) => {
          // Only the real game page refreshes the offline shell (not index.beta.html or other pages).
          const scopePath = new URL('./', self.location.href).pathname;
          const isShellPage = url.pathname === scopePath || url.pathname === scopePath + 'index.html';
          if (res.ok) {
            await caches.open(CACHE)
              .then((cache) => cache.put(isShellPage ? './' : req, res.clone()))
              .catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req.mode === 'navigate' ? './' : req))
    );
    return;
  }

  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
