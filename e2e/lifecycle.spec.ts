/** A lifter's life in the app, start to finish: training each kind of
 * program, the interruptions and mistakes of real sessions, correcting
 * history, and the settings that shape it. All against the real worker, with
 * nothing mocked. */
import { test, expect } from "./fixtures";
import { useNetwork } from "./network";
import {
  createAccount,
  exercise,
  finish,
  logReps,
  openSettings,
  programRow,
  signInWithPasskey,
  startNext,
} from "./steps";

// Logging never touches the network; offline proves the app still opens and
// navigates from the service worker's cache while doing it.
for (const network of ["online", "offline"] as const) {
  test(`StrongLifts (${network}): a clean session adds weight, a missed rep holds it`, async ({ phone }) => {
    const p = await phone();
    await createAccount(p.page, "Isaac");
    const restore = await useNetwork(p, network);

    // Workout A, every rep: squat, bench and row each go up 2.5kg.
    await startNext(p.page);
    await logReps(p.page, "Squat", [5, 5, 5, 5, 5]);
    await logReps(p.page, "Bench press", [5, 5, 5, 5, 5]);
    await logReps(p.page, "Barbell row", [5, 5, 5, 5, 5]);
    await finish(p.page);

    // Workout B, a missed rep on the last squat set: squat holds; OHP and the
    // deadlift (1×5, +5kg) go up.
    await startNext(p.page);
    await expect(p.page.getByText("Workout B").first()).toBeVisible();
    await logReps(p.page, "Squat", [5, 5, 5, 5, 4]);
    await logReps(p.page, "Overhead press", [5, 5, 5, 5, 5]);
    await logReps(p.page, "Deadlift", [5]);
    await finish(p.page);

    await expect(await programRow(p.page, "Workout A", "Bench press")).toContainText("22.5kg");
    await expect(await programRow(p.page, "Workout A", "Barbell row")).toContainText("32.5kg");
    await expect(await programRow(p.page, "Workout B", "Squat")).toContainText("22.5kg");
    await expect(await programRow(p.page, "Workout B", "Overhead press")).toContainText("22.5kg");
    await expect(await programRow(p.page, "Workout B", "Deadlift")).toContainText("45kg");
    await restore();
  });
}

test("an interrupted workout survives minimizing and closing the app, and resumes where it was", async ({ phone }) => {
  const p = await phone();
  await createAccount(p.page, "Isaac");
  await startNext(p.page);
  await logReps(p.page, "Squat", [5, 5]);

  await p.page.getByRole("button", { name: /Minimize workout/ }).click();
  await expect(p.page).toHaveURL(/localhost:\d+\/$/);
  await p.page.reload(); // the app is closed and reopened
  await p.page.getByRole("link", { name: /Resume/ }).click();
  const plates = exercise(p.page, "Squat").getByRole("button", { name: /reps (target|logged)/ });
  await expect(plates.nth(0)).toHaveAccessibleName(/^5 of 5 reps logged/);
  await expect(plates.nth(1)).toHaveAccessibleName(/^5 of 5 reps logged/);
  await expect(plates.nth(2)).toHaveAccessibleName(/pending/);
});

test("an empty workout is thrown away; a started one asks before discarding", async ({ phone }) => {
  const p = await phone();
  await createAccount(p.page, "Isaac");

  // Finishing with nothing logged saves nothing.
  await startNext(p.page);
  await p.page.getByRole("button", { name: "Finish workout" }).click();
  await p.page.getByRole("alertdialog").getByRole("button", { name: "Discard workout" }).click();

  // Discarding a started one says what it will delete, and does.
  await startNext(p.page);
  await logReps(p.page, "Squat", [5, 5]);
  await p.page.getByRole("button", { name: "Workout options" }).click();
  await p.page.getByRole("menuitem", { name: "Discard workout" }).click();
  await p.page.getByRole("alertdialog").getByRole("button", { name: "Delete 2 sets" }).click();
  await expect(p.page.getByRole("link", { name: /Resume/ })).toHaveCount(0);

  await openSettings(p.page);
  await expect(p.page.getByText(/^\d+ workouts? · \d+ sets/)).toHaveText(/^0 workout/);
});

test("correcting history: a past workout's reps and note can be fixed from History", async ({ phone }) => {
  const p = await phone();
  await createAccount(p.page, "Isaac");
  await startNext(p.page);
  await logReps(p.page, "Squat", [5, 5, 5, 5, 5]);
  await finish(p.page);

  await p.page.getByRole("button", { name: /^Edit Workout A from/ }).click();
  await expect(p.page.getByText(/^Editing ·/)).toBeVisible();
  // The last squat set was actually 3 reps.
  const last = exercise(p.page, "Squat").getByRole("button", { name: /reps logged/ }).nth(4);
  await last.click();
  await last.click();
  await expect(last).toHaveAccessibleName(/^3 of 5 reps logged/);
  await p.page.getByRole("button", { name: "Workout options" }).click();
  await p.page.getByRole("menuitem", { name: "Workout note" }).click();
  await p.page.getByPlaceholder(/How did it go/).fill("Knee felt off on the last set");
  await p.page.getByRole("button", { name: "Save note" }).click();
  await p.page.getByRole("button", { name: "Save workout" }).click();

  await expect(p.page.getByText("Knee felt off on the last set")).toBeVisible();
  await p.page.getByRole("button", { name: /^Edit Workout A from/ }).click();
  await expect(
    exercise(p.page, "Squat").getByRole("button", { name: /reps logged/ }).nth(4),
  ).toHaveAccessibleName(/^3 of 5 reps logged/);
});

test("Madcow: Monday's volume day hands over to Wednesday's light day", async ({ phone }) => {
  const p = await phone();
  await createAccount(p.page, "Isaac", "Madcow 5×5");
  await startNext(p.page);
  const sets = p.page.getByRole("button", { name: /^Log / });
  // Monday is three ramped lifts: bounded, so a set that won't log fails
  // the test instead of spinning.
  for (let i = 0; i < 30 && (await sets.count()) > 0; i++) await sets.first().click();
  await expect(sets).toHaveCount(0);
  await finish(p.page);
  await p.page.getByRole("navigation").getByRole("link", { name: "Home" }).click();
  await expect(p.page.getByRole("link", { name: /^Start Wednesday/ }).first()).toBeVisible();
});

test("a custom routine workout prefills each set from last time", async ({ phone }) => {
  const p = await phone();
  await createAccount(p.page, "Silvana", "Custom routine");
  await p.page.getByRole("navigation").getByRole("link", { name: "Program" }).click();
  await p.page.getByRole("button", { name: "Add exercise" }).first().click();
  await p.page.getByPlaceholder("Exercise name").fill("Hip thrust");
  await p.page.getByRole("dialog").getByRole("button", { name: "Add exercise" }).click();

  await startNext(p.page);
  await p.page.getByRole("spinbutton", { name: "Set 1 weight in kg" }).fill("60");
  await p.page.getByRole("spinbutton", { name: "Set 1 reps" }).fill("12");
  await p.page.getByRole("button", { name: "Mark set 1 done" }).click();
  await finish(p.page);

  await startNext(p.page);
  await expect(p.page.getByRole("spinbutton", { name: "Set 1 weight in kg" })).toHaveValue("60");
});

test("settings stick across a restart, and the theme follows to another phone", async ({ phone }) => {
  const p = await phone();
  await createAccount(p.page, "Isaac");
  await openSettings(p.page);

  const rest = p.page.getByRole("spinbutton", { name: /Default rest/ });
  await rest.fill("120");
  await p.page.getByRole("switch", { name: "Gym has 25kg plates" }).click();
  await p.page.getByRole("tab", { name: "Light" }).click();
  await expect(p.page.locator("html")).toHaveAttribute("data-theme", "light");

  await p.page.reload();
  await expect(p.page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(p.page.getByRole("spinbutton", { name: /Default rest/ })).toHaveValue("120");
  await expect(p.page.getByRole("switch", { name: "Gym has 25kg plates" })).not.toBeChecked();

  const other = await phone();
  await p.sharePasskeysWith(other);
  await signInWithPasskey(other.page);
  await expect(other.page.locator("html")).toHaveAttribute("data-theme", "light");
});
