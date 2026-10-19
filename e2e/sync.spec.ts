/** The promise of the app: train on one phone, whatever the network, and the
 * workout is on the other — once. These journeys block the second phone's
 * cloud snapshot, so the journal (the per-account SyncJournal) is the only
 * way across; signing out and back in tests the snapshot. */
import { test, expect, type Phone } from "./fixtures";
import { loseSyncReplies, useNetwork, withoutCloudRestore, type Network } from "./network";
import { createAccount, doWorkout, exercise, journal, openSettings, signInWithPasskey, signOut, uploaded } from "./steps";

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
    // On a flappy connection, the worst case: the push lands and the answer
    // is lost, so the phone sends it again.
    if (network === "flappy") await loseSyncReplies(first, 2);

    // Logging never waits on the network: it's on the phone the moment it's done.
    await doWorkout(first.page);
    await expect(first.page.getByText("Workout A").first()).toBeVisible();

    if (network === "flappy") {
      // Keep flapping through the sync: every foregrounding starts a push.
      for (let i = 0; i < 5; i++) {
        await first.page.reload().catch(() => {});
        await first.page.waitForTimeout(900);
      }
    }

    // The connection settles; opening the app is what pushes.
    await restore();
    await uploaded(first.page);
    // Once in the journal, however many times it was sent.
    expect((await journal(first.page)).filter((op) => op.kind === "finishedWorkout")).toHaveLength(1);

    const second = await phone();
    if (network === "slow") await useNetwork(second, "slow");
    await withoutCloudRestore(second);
    await first.sharePasskeysWith(second);
    await signInWithPasskey(second.page);
    await expect(await workoutsOn(second)).toHaveText(/^1 workout/, { timeout: 30_000 });
  });
}

test("signing out clears the phone, and signing back in brings the history back", async ({ phone }) => {
  const p = await phone();
  await createAccount(p.page, "Isaac");
  await doWorkout(p.page);
  await uploaded(p.page);

  await signOut(p.page);
  await signInWithPasskey(p.page);
  await expect(await workoutsOn(p)).toHaveText(/^1 workout/);
});

/** Open a past workout from History and change the last squat set to `reps`. */
async function correctLastSquat(phone: Phone, reps: number) {
  await phone.page.getByRole("navigation").getByRole("link", { name: "History" }).click();
  await phone.page.getByRole("button", { name: /^Edit Workout A from/ }).click();
  const last = exercise(phone.page, "Squat").getByRole("button", { name: /reps logged/ }).nth(4);
  for (let i = 0; i < 5 - reps; i++) await last.click();
  await expect(last).toHaveAccessibleName(new RegExp(`^${reps} of 5 reps logged`));
}

async function lastSquatOn(phone: Phone) {
  await phone.page.goto("/history");
  await phone.page.getByRole("button", { name: /^Edit Workout A from/ }).click();
  return exercise(phone.page, "Squat").getByRole("button", { name: /reps logged/ }).nth(4);
}

test("a correction reaches a phone that already has the workout — even leaving with Back", async ({ phone }) => {
  const first = await phone();
  await createAccount(first.page, "Isaac");
  await doWorkout(first.page);
  await uploaded(first.page);

  const second = await phone();
  await first.sharePasskeysWith(second);
  await signInWithPasskey(second.page);
  await expect(await workoutsOn(second)).toHaveText(/^1 workout/);

  // The last squat set was really 3 reps — and Back is how most people leave.
  await correctLastSquat(first, 3);
  await first.page.getByRole("button", { name: /^Back — logged changes are kept/ }).click();
  await expect(first.page).toHaveURL(/\/history/);
  await uploaded(first.page);

  await second.page.reload();
  await expect(await lastSquatOn(second)).toHaveAccessibleName(/^3 of 5 reps logged/, { timeout: 20_000 });
  await second.page.goto("/settings");
  await expect(second.page.getByText(/\d+ workouts? · \d+ sets/)).toHaveText(/^1 workout/);
});

// Two phones correct the same workout while offline. Whatever order their
// edits reach the journal, both must end on the later one.
test("two phones correcting the same workout offline agree on the later edit", async ({ phone }) => {
  const first = await phone();
  await createAccount(first.page, "Isaac");
  await doWorkout(first.page);
  await uploaded(first.page);
  const second = await phone();
  await first.sharePasskeysWith(second);
  await signInWithPasskey(second.page);
  await expect(await workoutsOn(second)).toHaveText(/^1 workout/);

  const restoreFirst = await useNetwork(first, "offline");
  const restoreSecond = await useNetwork(second, "offline");
  await correctLastSquat(first, 4);
  await first.page.getByRole("button", { name: "Save workout" }).click();
  await expect(first.page).toHaveURL(/\/history/);
  await first.page.waitForTimeout(50); // the second edit is unambiguously later
  await correctLastSquat(second, 2);
  await second.page.getByRole("button", { name: "Save workout" }).click();
  await expect(second.page).toHaveURL(/\/history/);

  // The later edit reaches the journal first; the earlier one after.
  await restoreSecond();
  await uploaded(second.page);
  await restoreFirst();
  await uploaded(first.page);
  await second.page.reload();

  await expect(await lastSquatOn(first)).toHaveAccessibleName(/^2 of 5 reps logged/, { timeout: 20_000 });
  await expect(await lastSquatOn(second)).toHaveAccessibleName(/^2 of 5 reps logged/);
});
