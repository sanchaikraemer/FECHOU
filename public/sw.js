// Service worker do Fechou — instalável + shell offline.
// Estratégia segura para Next.js:
//   • navegações  → network-first, com fallback para /offline.html
//   • _next/static e /assets (imutáveis, com hash) → cache-first
//   • API e o resto → passthrough (rede)
const VERSION = "fechou-v1";
const PRECACHE = `${VERSION}-precache`;
const RUNTIME = `${VERSION}-runtime`;
const PRECACHE_URLS = [
  "/offline.html",
  "/manifest.json",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((c) => c.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // só mesma origem

  // Navegações → network-first, fallback offline
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/offline.html").then((r) => r || Response.error()),
      ),
    );
    return;
  }

  // Estáticos imutáveis → cache-first
  if (
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/assets")
  ) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(RUNTIME).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }
  // resto (inclui /api/*) → passthrough
});
