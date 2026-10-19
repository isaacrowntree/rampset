/* Rampset service worker: network-first for navigations with cache fallback,
 * cache-first for static assets. The data layer lives in IndexedDB, so the
 * shell is all we need to make the app open in a gym dead zone. */

const CACHE = "rampset-shell-v7";
/** The shell must cache or offline is broken — fail install if it can't. */
const CORE = ["/", "/manifest.webmanifest", "/icon.svg"];
/** Every tab's document, so a COLD offline navigation (e.g. tapping History
 * straight after a gym workout, having never opened it online this session)
 * serves the right page instead of falling back to the home shell. */
const ROUTES = ["/workout", "/history", "/program", "/progress", "/settings"];

/** Gym dead zones don't fail fetches — they hang them. Anything
 * network-first must give up quickly and fall back to cache. */
const NETWORK_TIMEOUT_MS = 3000;

function timeout(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(undefined), ms));
}

/** A cached page is only half the page: its scripts and styles load from
 * /_next/static, and cache-first only keeps what was fetched online. Without
 * this, a tab never opened online (the first workout, in a dead zone) serves
 * its HTML and then fails on its chunks. */
async function cacheAssetsOf(cache, page) {
  const html = await page.clone().text();
  const assets = new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]));
  await Promise.allSettled(
    [...assets].map(async (url) => (await cache.match(url)) ?? cache.add(url)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // Shell is critical (addAll is atomic — one failure fails install).
      await cache.addAll(CORE);
      // Routes are best-effort: a single unreachable page must not block the
      // install, and they refresh on every online navigation anyway.
      await Promise.allSettled(ROUTES.map((r) => cache.add(r)));
      for (const route of [...CORE.slice(0, 1), ...ROUTES]) {
        const page = await cache.match(route);
        if (page) await cacheAssetsOf(cache, page).catch(() => {});
      }
      await self.skipWaiting();
    }),
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
        // A deploy changes the chunk hashes: keep the new ones with the page.
        caches.open(CACHE).then((cache) =>
          cache.put(request, copy.clone()).then(() => cacheAssetsOf(cache, copy)),
        );
      }
      return res;
    });
    // Keep the slow fetch alive after we've answered from cache — when it
    // eventually lands it still refreshes the shell for next time.
    event.waitUntil(network.catch(() => {}));
    // ignoreSearch: the pages are client-rendered shells that read their own
    // query, and `/workout?day=…` must find the cached `/workout` — or a cold
    // offline launch can't start a workout.
    const cached = () =>
      caches.match(request, { ignoreSearch: true }).then((hit) => hit ?? caches.match("/"));
    event.respondWith(
      Promise.race([network, timeout(NETWORK_TIMEOUT_MS)])
        .then((res) =>
          res ??
          cached()
            // Nothing cached (first visit): keep waiting on the network.
            .then((hit) => hit ?? network),
        )
        .catch(cached),
    );
    return;
  }

  // App Router client navigations (router.push / Link) fetch RSC payloads.
  // Never serve the cached HTML shell for these — on a stalled network,
  // fail fast instead, so the router falls back to a full navigation and
  // the navigate branch above serves the offline shell.
  //
  // Not Response.error(): a failed fetch makes the router give up on a "This
  // page couldn't load" screen. A plain non-RSC response instead makes it fall
  // back to a full navigation — which the navigate branch serves offline.
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) {
    const unreachable = () => new Response(null, { status: 503 });
    event.respondWith(
      Promise.race([fetch(request), timeout(NETWORK_TIMEOUT_MS)]).then(
        (res) => res ?? unreachable(),
        unreachable,
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
