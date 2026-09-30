/* Bonwise service worker: makes the app installable and opens it instantly.
   - The app page opens from this phone's copy straight away, and the newest version is
     fetched in the background for next time. So users never see the "starting" page of a
     sleeping server (Render's free plan spins down after a quiet while).
   - Only Bonwise's own page, script, icons and manifest are kept. Answers from /api/
     (receipts, prices, household) always come fresh from the server; nothing personal is cached. */
const CACHE = "bonwise-v4";
const PAGE = "/";
const SHELL = ["/offline.html", "/manifest.webmanifest", "/static/icons/icon-192.png", "/static/favicon.png"];
// Versioned files the page points to (app.js?v=…, i18n.js?v=…, fonts.css?v=…).
const VERSIONED = /\/static\/[\w\/.-]+\.(?:js|css)\?v=\d+/g;

// Only answers that really come from Bonwise are kept (not Render's wake-up page).
function ours(res) { return !!res && res.ok && res.headers.get("X-Bonwise") === "1"; }

function keep(cache, url) {
  return fetch(url, { cache: "no-store" }).then((res) => (ours(res) ? cache.put(url, res) : null)).catch(() => null);
}

// Fetch the newest page and the exact files it points to; store them only when all arrived,
// then drop older versions of those files.
function refreshPage() {
  return fetch(PAGE, { cache: "no-store" }).then((res) => {
    if (!ours(res)) return null;
    return res.clone().text().then((html) => {
      const wanted = [...new Set(html.match(VERSIONED) || [])];
      return Promise.all(wanted.map((u) => fetch(u).then((r) => (ours(r) ? [u, r] : Promise.reject(new Error(u))))))
        .then((files) => caches.open(CACHE).then((c) =>
          Promise.all(files.map(([u, r]) => c.put(u, r)))
            .then(() => c.put(PAGE, res))
            .then(() => c.keys())
            .then((keys) => {
              const keepPaths = new Set(wanted.map((u) => u.split("?")[0]));
              return Promise.all(keys.filter((k) => {
                const u = new URL(k.url);
                return keepPaths.has(u.pathname) && u.search && !wanted.includes(u.pathname + u.search);
              }).map((k) => c.delete(k)));
            })));
    });
  }).catch(() => null);
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => keep(c, u)))).then(refreshPage));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/.well-known/")) return;

  if (req.mode === "navigate") {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      // The app page: this phone's copy at once (the background fetch also wakes the server).
      e.waitUntil(refreshPage());
      e.respondWith(caches.match(PAGE).then((hit) => hit || fetch(req).catch(() => caches.match("/offline.html"))));
      return;
    }
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }

  if (url.pathname.startsWith("/static/") || url.pathname === "/manifest.webmanifest") {
    // Versioned script (app.js?v=…) never changes; other files are refreshed in the background.
    e.respondWith(caches.match(req).then((hit) => {
      if (hit && url.search) return hit;
      const net = fetch(req).then((res) => {
        if (ours(res)) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy))); }
        return res;
      });
      if (hit) { e.waitUntil(net.catch(() => null)); return hit; }
      return net.catch(() => caches.match(req));
    }));
  }
});
