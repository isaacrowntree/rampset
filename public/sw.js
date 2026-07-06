/* Rampset service worker: network-first for navigations with cache fallback,
 * cache-first for static assets. The data layer lives in IndexedDB, so the
 * shell is all we need to make the app open in a gym dead zone. */

const CACHE = "rampset-shell-v5";
const PRECACHE = ["/", "/manifest.webmanifest", "/icon.svg"];

/** Gym dead zones don't fail fetches — they hang them. Anything
 * network-first must give up quickly and fall back to cache. */
const NETWORK_TIMEOUT_MS = 3000;

function timeout(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(undefined), ms));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (request.mode === "navigate") {
    // Network-first so deploys land; cached shell when offline OR when the
    // network stalls past the timeout. Only cache successful responses —
    // a cached 500 would poison the offline shell.
    const network = fetch(request).then((res) => {
      // Cache only healthy same-origin responses. Behind Cloudflare
      // Access, an expired session redirects to the login page with a
      // 200 — caching that would poison the offline shell.
      if (res.ok && !res.redirected && res.url.startsWith(location.origin)) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return res;
    });
    // Keep the slow fetch alive after we've answered from cache — when it
    // eventually lands it still refreshes the shell for next time.
    event.waitUntil(network.catch(() => {}));
    event.respondWith(
      Promise.race([network, timeout(NETWORK_TIMEOUT_MS)])
        .then((res) =>
          res ??
          caches
            .match(request)
            .then((hit) => hit ?? caches.match("/"))
            // Nothing cached (first visit): keep waiting on the network.
            .then((hit) => hit ?? network),
        )
        .catch(() => caches.match(request).then((hit) => hit ?? caches.match("/"))),
    );
    return;
  }

  // App Router client navigations (router.push / Link) fetch RSC payloads.
  // Never serve the cached HTML shell for these — on a stalled network,
  // fail fast instead, so the router falls back to a full navigation and
  // the navigate branch above serves the offline shell.
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) {
    event.respondWith(
      Promise.race([fetch(request), timeout(NETWORK_TIMEOUT_MS)]).then(
        (res) => res ?? Response.error(),
        () => Response.error(),
      ),
    );
    return;
  }

  // Static assets: cache-first.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          if (res.ok && (url.pathname.startsWith("/_next/") || url.pathname.match(/\.(svg|css|js|woff2?)$/))) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
