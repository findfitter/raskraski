// Service worker: всё приложение кладётся в кэш при установке, дальше работает без сети.
// Стратегия: сначала кэш, параллельно тихое обновление (stale-while-revalidate).
// Изменил файлы приложения — увеличь номер версии, чтобы старый кэш был заменён.
const VERSION = 'raskraska-v11';
const ASSETS = [
  './', 'index.html', 'free.html', 'kit.html', 'manifest.json', 'css/style.css', 'css/kit.css',
  'js/main.js', 'js/regions.js', 'js/worker.js', 'js/viewer.js', 'js/paint.js', 'js/palette.js', 'js/catalog.js', 'js/db.js', 'js/effects.js', 'js/paintlayer.js', 'js/loader.js', 'js/kit-style.js', 'js/kit.js', 'js/anim.js', 'js/kit-data.js', 'js/kit-data-complex.js', 'js/kit-colormaps.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  ...Array.from({ length: 13 }, (_, i) => `images/p${String(i + 1).padStart(2, '0')}.jpg`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    return Response.error();
  })());
});
