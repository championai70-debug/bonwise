// Offline support for the web version: the app files are kept on the device and served from
// there first, then refreshed in the background. User data is never cached here (it lives in
// IndexedDB) and the app makes no other network requests.
const CACHE = 'salesplan-v2';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'privacy.html', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'js/app.js', 'js/engine.js', 'js/csv.js', 'js/xlsx.js', 'js/vault.js', 'js/ui.js', 'js/sample.js', 'js/model.js', 'js/train-worker.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || fresh;
  }));
});
