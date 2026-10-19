/** Getting in, getting back in, and leaving — through the real Auth DO and
 * the real email binding (codes are read from what it wrote). */
import { test, expect } from "./fixtures";

/** Unique per run: the server caps codes per email per hour, and a reused
 * dev server remembers earlier runs. */
const inbox = (name: string) => `${name}+${Date.now()}@example.com`;
import { emailedCode } from "./fixtures";
import { createAccount, doWorkout, errorMessage, openSettings, signInWithPasskey, signOut } from "./steps";

test("a lifter who loses their phone gets back in by email, and the lost phone is signed out", async ({ phone }) => {
  const email = inbox("isaac");
  const lost = await phone();
  await createAccount(lost.page, "Isaac", "StrongLifts 5×5", email);
  await doWorkout(lost.page);

  // A new phone with no passkey on it.
  const fresh = await phone();
  await fresh.page.goto("/");
  await fresh.page.getByRole("button", { name: /Recover by email/ }).click();
  const since = Date.now();
  await fresh.page.getByRole("textbox", { name: "Email" }).fill(email);
  await fresh.page.getByRole("button", { name: "Send code" }).click();
  await fresh.page.getByRole("textbox", { name: "6-digit code" }).fill(await emailedCode(since));
  await fresh.page.getByRole("button", { name: "Continue" }).click();

  // Back in — and asked to put a passkey on this phone for next time.
  await fresh.page.getByRole("button", { name: "Add passkey" }).click();
  await openSettings(fresh.page);
  await expect(fresh.page.getByText(/^1 workout/)).toBeVisible();

  // The new passkey works on its own.
  await signOut(fresh.page);
  await signInWithPasskey(fresh.page);

  // Whoever has the lost phone is out: recovery ended its session. Its data
  // stays on it, but nothing more syncs.
  await lost.page.reload();
  await openSettings(lost.page);
  await expect(lost.page.getByText("Signed out — sync and backup are paused")).toBeVisible();
});

test("a recovery code can't be guessed past five tries", async ({ phone }) => {
  const email = inbox("guess");
  const p = await phone();
  await createAccount(p.page, "Isaac", "StrongLifts 5×5", email);
  const stranger = await phone();
  await stranger.page.goto("/");
  await stranger.page.getByRole("button", { name: /Recover by email/ }).click();
  const since = Date.now();
  await stranger.page.getByRole("textbox", { name: "Email" }).fill(email);
  await stranger.page.getByRole("button", { name: "Send code" }).click();
  const real = await emailedCode(since);
  const wrong = (n: number) => String((Number(real) + n) % 1_000_000).padStart(6, "0");

  const code = stranger.page.getByRole("textbox", { name: "6-digit code" });
  for (let i = 1; i <= 5; i++) {
    await code.fill(wrong(i));
    await stranger.page.getByRole("button", { name: "Continue" }).click();
    await expect(errorMessage(stranger.page)).toHaveText(/wrong or has expired/);
  }
  await code.fill(real);
  await stranger.page.getByRole("button", { name: "Continue" }).click();
  await expect(errorMessage(stranger.page)).toHaveText(/wrong or has expired/);
});

test("deleting an account removes it everywhere — its passkey no longer signs in", async ({ phone }) => {
  const p = await phone();
  await createAccount(p.page, "Gone");
  await doWorkout(p.page);
  const other = await phone();
  await p.sharePasskeysWith(other);

  await openSettings(p.page);
  await p.page.getByRole("button", { name: "Delete account" }).click();
  await p.page.getByRole("alertdialog").getByRole("button", { name: "Delete account" }).click();
  await expect(p.page.getByRole("button", { name: "Create account" })).toBeVisible();

  await other.page.goto("/");
  await other.page.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(errorMessage(other.page)).toHaveText(/No account uses this passkey/);
});
