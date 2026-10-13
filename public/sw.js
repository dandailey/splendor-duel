// Splendor Duel service worker: offline shell and generic turn notifications.
// Network-first for pages, scripts and styles; cached copies are the offline fallback.
// Never touches GameSync (different path and origin-scope) or cross-origin requests.
const CACHE = 'splendor-duel-shell-v4';
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

self.addEventListener('push', (event) => {
  event.waitUntil(self.registration.showNotification('Splendor Duel', {
    body: 'Your turn', tag: 'splendor-duel-turn', renotify: true,
    icon: 'icons/icon-192.png', data: { url: './' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const scope = new URL(self.registration.scope);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => {
      const url = new URL(client.url);
      return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
    });
    if (existing) return existing.focus();
    return self.clients.openWindow('./');
  })());
});
