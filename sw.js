const CACHE = 'camera-ops-v1';
const URLS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './img/icon-192.png',
  './img/icon-512.png',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.startsWith('http') &&
      !e.request.url.includes('cdn.jsdelivr.net') &&
      !e.request.url.includes('unpkg.com')) {
    e.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(e.request).then((r) => r || fetch(e.request).then((r2) => {
          c.put(e.request, r2.clone());
          return r2;
        }))
      ).catch(() => fetch(e.request))
    );
  }
});
