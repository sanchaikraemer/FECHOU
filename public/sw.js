const VERSION = "radar-v004";
const PRECACHE = `${VERSION}-precache`;
const RUNTIME = `${VERSION}-runtime`;
const SHARE_CACHE = "radar-share";
const PRECACHE_URLS = [
  "/offline.html",
  "/manifest.json",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== PRECACHE && key !== RUNTIME && key !== SHARE_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function handleShareTarget(request) {
  try {
    const form = await request.formData();
    const files = form
      .getAll("files")
      .filter((file) => file && typeof file === "object" && typeof file.size === "number" && file.size > 0);
    const text = form.get("text");
    const cache = await caches.open(SHARE_CACHE);
    for (const key of await cache.keys()) await cache.delete(key);

    const metadata = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const key = `/__shared__/file-${index}`;
      await cache.put(new Request(key), new Response(file, { headers: { "content-type": file.type || "application/octet-stream" } }));
      metadata.push({ key, name: file.name || `arquivo-${index}`, type: file.type || "" });
    }

    await cache.put(
      new Request("/__shared__/index.json"),
      new Response(JSON.stringify({ files: metadata, text: typeof text === "string" ? text : "", createdAt: Date.now() }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      }),
    );
  } catch {
    // O aplicativo mostrará o fluxo manual se o compartilhamento não puder ser lido.
  }

  return Response.redirect(new URL("/?shared=1", self.location.origin).toString(), 303);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/share") {
    event.respondWith(handleShareTarget(request));
    return;
  }

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html").then((response) => response || Response.error())));
    return;
  }

  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/assets")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(RUNTIME).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
