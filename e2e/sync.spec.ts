/** The promise of the app: train on one phone, whatever the network, and the
 * workout is on the other — once. End to end through the Auth DO (passkeys,
 * sessions), the per-account SyncJournal, and the R2 snapshot a new phone
 * restores from. */
import { test, expect, type Phone } from "./fixtures";
import { useNetwork, type Network } from "./network";
import { createAccount, doWorkout, exercise, openSettings, signInWithPasskey, signOut } from "./steps";

/** This phone's own count, from Settings → Your data. */
async function workoutsOn(phone: Phone) {
  await openSettings(phone.page);
  return phone.page.getByText(/\d+ workouts? · \d+ sets/);
}

for (const network of ["online", "offline", "flappy", "slow"] as const satisfies Network[]) {
  test(`${network}: a workout reaches the lifter's second phone exactly once`, async ({ phone }) => {
    test.setTimeout(network === "slow" ? 240_000 : 90_000);
    const first = await phone();
    // Slow is slow from the start — signing up included. The others sign up
    // at home and train somewhere worse.
    const restoreFirst = network === "slow" ? await useNetwork(first, "slow") : undefined;
    await createAccount(first.page, "Isaac");
    const restore = restoreFirst ?? (await useNetwork(first, network));

    // Logging never waits on the network: it's on the phone the moment it's done.
    await doWorkout(first.page);
    await expect(first.page.getByText("Workout A").first()).toBeVisible();

    if (network === "flappy") {
      // Keep flapping through the sync too: every foregrounding starts a push
      // that the next drop cuts off mid-request. Each must land at most once.
      for (let i = 0; i < 5; i++) {
        await first.page.reload().catch(() => {});
        await first.page.waitForTimeout(900);
      }
    }

    // The connection settles; opening the app is what pushes.
    await restore();
    await first.page.reload();
    await openSettings(first.page);
    await expect(first.page.getByText(/^Synced/)).toBeVisible({ timeout: 30_000 });

    const second = await phone();
    if (network === "slow") await useNetwork(second, "slow");
    await first.sharePasskeysWith(second);
    await signInWithPasskey(second.page);
    await expect(await workoutsOn(second)).toHaveText(/^1 workout/, { timeout: 30_000 });
  });
}

test("signing out clears the phone, and signing back in brings the history back", async ({ phone }) => {
  const p = await phone();
  await createAccount(p.page, "Isaac");
  await doWorkout(p.page);

  await signOut(p.page);

  await signInWithPasskey(p.page);
  await expect(await workoutsOn(p)).toHaveText(/^1 workout/);
});

test("correcting a past workout reaches a phone that already has it", async ({ phone }) => {
  const first = await phone();
  await createAccount(first.page, "Isaac");
  await doWorkout(first.page);
  await first.page.reload();
  await openSettings(first.page);
  await expect(first.page.getByText(/^Synced/)).toBeVisible({ timeout: 30_000 });

  const second = await phone();
  await first.sharePasskeysWith(second);
  await signInWithPasskey(second.page);
  await expect(await workoutsOn(second)).toHaveText(/^1 workout/);

  // On the first phone: the last squat set was really 3 reps.
  await first.page.getByRole("navigation").getByRole("link", { name: "History" }).click();
  await first.page.getByRole("button", { name: /^Edit Workout A from/ }).click();
  const last = exercise(first.page, "Squat").getByRole("button", { name: /reps logged/ }).nth(4);
  await last.click();
  await last.click();
  await first.page.getByRole("button", { name: "Save workout" }).click();
  await expect(first.page).toHaveURL(/\/history/);
  await first.page.reload();
  await openSettings(first.page);
  await expect(first.page.getByText(/^Synced/)).toBeVisible({ timeout: 30_000 });

  // The second phone picks it up next time it's opened.
  await second.page.reload();
  await second.page.getByRole("navigation").getByRole("link", { name: "History" }).click();
  await second.page.getByRole("button", { name: /^Edit Workout A from/ }).click();
  await expect(
    exercise(second.page, "Squat").getByRole("button", { name: /reps logged/ }).nth(4),
  ).toHaveAccessibleName(/^3 of 5 reps logged/, { timeout: 20_000 });
  // Corrected in place, not added as a second workout.
  await second.page.goto("/settings");
  await expect(second.page.getByText(/\d+ workouts? · \d+ sets/)).toHaveText(/^1 workout/);
});
