/** The networks a lifter actually has. Each returns a function that restores
 * a normal connection.
 *
 * - offline: nothing gets through (airplane mode, the basement gym).
 * - flappy: the connection drops and returns every second or so — what a
 *   phone does walking between a gym floor and a car park.
 * - slow: everything arrives, late — high latency, a trickle of bandwidth.
 *
 * Applied at the browser-context level so they reach the service worker's
 * own fetches too, not just the page's. */
import type { Phone } from "./fixtures";

export type Network = "online" | "offline" | "flappy" | "slow";

/** Every request waits this long: high latency, fixed so a failure replays. */
const SLOW_MS = 1500;

/** The server applies a push, and the reply never makes it back — the case
 * that tests idempotency, not whether a push happened to start. Drops the
 * first `n` replies to POST /api/sync. */
export async function loseSyncReplies(phone: Phone, n: number): Promise<void> {
  let lost = 0;
  await phone.context.route("**/api/sync", async (route) => {
    if (route.request().method() === "POST" && lost < n) {
      lost++;
      await route.fetch(); // it reaches the journal…
      return route.abort("connectionreset"); // …the answer doesn't reach the phone
    }
    return route.continue();
  });
}

/** Only the journal can deliver: no cloud snapshot on this phone. */
export async function withoutCloudRestore(phone: Phone): Promise<void> {
  await phone.context.route("**/api/backup", (route) => route.fulfill({ status: 404, json: { error: "blocked" } }));
}

/** The app has been opened online once: its service worker is installed,
 * has cached the shell and every page's assets, and controls the page. Only
 * then is the network fair game — a phone in the gym got here at home. */
export async function installed(phone: Phone): Promise<void> {
  await phone.page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
    }
  });
}

export async function useNetwork(phone: Phone, network: Network): Promise<() => Promise<void>> {
  const { context } = phone;
  if (network === "offline" || network === "flappy") await installed(phone);
  switch (network) {
    case "online":
      return async () => {};

    case "offline":
      await context.setOffline(true);
      return () => context.setOffline(false);

    case "flappy": {
      // Deterministic, so a failure replays: on 700ms, off 500ms, on 300ms…
      const pattern = [700, 500, 300, 900, 400, 600];
      let i = 0;
      let offline = false;
      let stopped = false;
      const loop = (async () => {
        while (!stopped) {
          offline = !offline;
          await context.setOffline(offline).catch(() => {});
          await new Promise((r) => setTimeout(r, pattern[i++ % pattern.length]));
        }
      })();
      return async () => {
        stopped = true;
        await loop;
        await context.setOffline(false);
      };
    }

    case "slow": {
      // ~3G at its worst: every request waits, then trickles.
      await context.route("**/*", async (route) => {
        await new Promise((r) => setTimeout(r, SLOW_MS));
        await route.continue().catch(() => {});
      });
      return () => context.unrouteAll({ behavior: "ignoreErrors" });
    }
  }
}
