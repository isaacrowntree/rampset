/** What a lifter does, in the words of the UI — shared by the journeys. */
import { expect, type Page } from "@playwright/test";
import { emailedCode } from "./fixtures";

export async function createAccount(
  page: Page,
  name: string,
  program: "StrongLifts 5×5" | "Madcow 5×5" | "Custom routine" = "StrongLifts 5×5",
  recoveryEmail?: string,
) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("textbox", { name: "Your name" }).fill(name);
  await page.getByRole("button", { name: new RegExp(`^${program}`) }).click();
  await page.getByRole("button", { name: "Create with passkey" }).click();
  await expect(page.getByRole("heading", { name: "Add a recovery email" })).toBeVisible();
  if (recoveryEmail) {
    const since = Date.now();
    await page.getByRole("textbox", { name: "Email" }).fill(recoveryEmail);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByRole("textbox", { name: "6-digit code" }).fill(await emailedCode(since));
    await page.getByRole("button", { name: "Continue" }).click();
  } else {
    await page.getByRole("button", { name: "Not now" }).click();
  }
  await expect(page.getByRole("navigation")).toBeVisible();
}

export async function signInWithPasskey(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
}

/** Start the next workout, log `sets` work sets at target, finish it. */
export async function doWorkout(page: Page, sets = 5) {
  await page.goto("/");
  await page.getByRole("link", { name: /^Start / }).first().click();
  const pending = page.getByRole("button", { name: /^Set pending/ });
  for (let i = 0; i < sets; i++) await pending.first().click();
  await finish(page);
}

/** Wait until this phone has nothing left to upload. ("Synced …" alone can
 * be a stale success from before the latest change.) */
export async function uploaded(page: Page) {
  await page.reload(); // foregrounding is what pushes
  await openSettings(page);
  await expect(page.getByText("Everything on this device is uploaded.")).toBeVisible({ timeout: 30_000 });
}

/** The account's journal, as the server holds it. */
export async function journal(page: Page): Promise<{ opId: string; kind: string }[]> {
  const res = await page.request.get("/api/sync?since=0");
  return ((await res.json()) as { ops: { opId: string; kind: string }[] }).ops;
}

export async function openSettings(page: Page) {
  await page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

/** Sign out, and wait for the app's own reload to finish. */
export async function signOut(page: Page) {
  await openSettings(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
}

/** The app's own error message. (Next's route announcer is also an alert.) */
export function errorMessage(page: Page) {
  return page.getByRole("alert").filter({ hasText: /\S/ });
}

/** One exercise's block on the workout screen. */
export function exercise(page: Page, name: string) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name, exact: true }) });
}

/** Log a progression exercise's work sets: each number is the reps done.
 * A plate fills to target on the first tap and counts down on each after. */
export async function logReps(page: Page, name: string, reps: number[], target = 5) {
  const plates = exercise(page, name).getByRole("button", { name: /reps (target|logged)/ });
  for (let i = 0; i < reps.length; i++) {
    for (let tap = 0; tap < 1 + (target - reps[i]); tap++) await plates.nth(i).click();
    await expect(plates.nth(i)).toHaveAccessibleName(new RegExp(`^${reps[i]} of ${target} reps logged`));
  }
}

export async function startNext(page: Page) {
  await page.getByRole("navigation").getByRole("link", { name: "Home" }).click();
  await page.getByRole("link", { name: /^Start / }).first().click();
  await expect(page.getByRole("button", { name: "Finish workout" })).toBeVisible();
}

export async function finish(page: Page) {
  await page.getByRole("button", { name: "Finish workout" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Finish workout" }).click();
  await expect(page).toHaveURL(/\/history/);
}

/** The Program tab's summary for an exercise on a day, e.g. "5×5 · 22.5kg". */
export async function programRow(page: Page, day: string, name: string) {
  await page.getByRole("navigation").getByRole("link", { name: "Program" }).click();
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: day, exact: true }) });
  return section.getByRole("button", { name: `Edit ${name}` });
}
