/** What the browser is told and kept: the API is never answered from the
 * service worker's cache, and every response carries the security headers. */
import { test, expect } from "./fixtures";
import { installed } from "./network";
import { createAccount, openSettings, signInWithPasskey, signOut } from "./steps";

// Opening an API URL directly (a link from anywhere does it) once stored the
// JSON under its path, and every later fetch of it was answered from there —
// a frozen /api/auth/session pinned who the app thought was signed in.
test("an API response opened as a page is never served from the cache", async ({ phone }) => {
  const p = await phone();
  await createAccount(p.page, "Isaac");
  await installed(p);

  await p.page.goto("/api/auth/session");
  await expect(p.page.getByText('"account"')).toBeVisible();
  await p.page.goto("/");
  await p.context.clearCookies();

  const status = await p.page.evaluate(async () => (await fetch("/api/auth/session")).status);
  expect(status).toBe(401);
  const keys = await p.page.evaluate(async () =>
    (await Promise.all((await caches.keys()).map(async (n) => (await caches.open(n)).keys())))
      .flat()
      .map((r) => new URL(r.url).pathname),
  );
  expect(keys.filter((k) => k.startsWith("/api/"))).toEqual([]);
});

// Set by the Worker, so they're on rendered pages and the API — not only on
// static files, which is all public/_headers can reach.
test("pages and the API carry the security headers, and the API is never cached", async ({ phone }) => {
  const p = await phone();
  for (const path of ["/", "/settings", "/api/auth/config"]) {
    const res = await p.page.request.get(path);
    const headers = res.headers();
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"], path).toContain("object-src 'none'");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
  }
  expect((await p.page.request.get("/api/auth/config")).headers()["cache-control"]).toBe("private, no-store");
});

// Two tabs on one phone. A signs out in one and someone else signs in; the
// other tab still holds A in memory and would go on writing as A — under B's
// session. It must notice and start over, and the server must refuse it if
// it doesn't.
test("a tab left open across a sign-out starts over, and the server refuses a stale account", async ({ phone }) => {
  const p = await phone();
  await createAccount(p.page, "Isaac");
  const a = await p.page.evaluate(() => localStorage.getItem("liftlog.sessionAccount"));
  const stale = await p.context.newPage();
  await stale.goto("/");
  await expect(stale.getByRole("navigation")).toBeVisible();

  await signOut(p.page);
  await expect(stale.getByRole("button", { name: "Create account" })).toBeVisible();

  await createAccount(p.page, "Sam");
  const res = await p.page.request.post("/api/sync", {
    headers: { "x-account": a!, origin: new URL(p.page.url()).origin },
    data: { ops: [{ opId: "stale-1", kind: "finishedWorkout", payload: {} }] },
  });
  expect(res.status()).toBe(409);
  expect(await res.json()).not.toHaveProperty("seq");
});

// A phone stolen while signed in used to stay signed in for good: Settings
// had no way to reach it. Now it does.
test("signing other devices out from Settings ends the lost phone's session", async ({ phone }) => {
  const kept = await phone();
  await createAccount(kept.page, "Isaac");
  const lost = await phone();
  await kept.sharePasskeysWith(lost);
  await signInWithPasskey(lost.page);

  await openSettings(kept.page);
  await kept.page.getByRole("button", { name: /^Passkeys and devices/ }).click();
  await expect(kept.page.getByRole("list", { name: "Passkeys" }).getByRole("listitem")).toHaveCount(1);
  await kept.page.getByRole("button", { name: "Sign out other devices" }).click();
  await kept.page.getByRole("alertdialog").getByRole("button", { name: "Sign out others" }).click();
  await expect(kept.page.getByText("Every other device is signed out.")).toBeVisible();

  expect((await lost.page.request.get("/api/auth/session")).status()).toBe(401);
  expect((await kept.page.request.get("/api/auth/session")).status()).toBe(200);
});
