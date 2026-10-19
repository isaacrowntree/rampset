/** The lifter's data is theirs: in from another app, out as a file, and back
 * in under a new account — the path for moving off the old Access build. */
import { test, expect } from "./fixtures";
import { readFileSync } from "node:fs";
import { createAccount, doWorkout, openSettings } from "./steps";

const STRONGLIFTS = `Date (yyyy/mm/dd),Workout,Workout Name,Program Name,Body Weight (KG),Exercise,SetsxReps,SetsxTime,Top Set Reps x KG,e1RM  (KG),Reps,Volume (KG),Workout Volume (KG),Duration (hours),Start Time (h:mm),End Time (h:mm),Notes,Set 1 (Reps), Set 1 (KG),Set 2 (Reps), Set 2 (KG)
"2015/05/25","1","Workout A","","87","Squat","2x5","","5x20","24.7","10","200","","1","7:37 PM","8:37 PM","","5","20","5","20"
"2015/05/27","2","Workout B","","87","Deadlift","1x5","","5x40","46","5","200","","1","7:37 PM","8:37 PM","","5","40","",""
"2015/05/29","3","Workout A","","87","Squat","2x5","","5x22.5","26","10","225","","1","7:37 PM","8:37 PM","","5","22.5","5","22.5"`;

test("history comes across from StrongLifts", async ({ phone }) => {
  const p = await phone();
  await createAccount(p.page, "Isaac");
  await openSettings(p.page);
  await p.page.getByLabel("Import from another app").setInputFiles({
    name: "Stronglifts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(STRONGLIFTS),
  });
  const confirm = p.page.getByRole("alertdialog");
  await expect(confirm).toContainText("3 workouts from StrongLifts");
  await confirm.getByRole("button", { name: "Import" }).click();
  await expect(p.page.getByText(/^\d+ workouts? · \d+ sets/)).toHaveText(/^3 workout/);

  // Importing the same file again adds nothing.
  await p.page.getByLabel("Import from another app").setInputFiles({
    name: "Stronglifts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(STRONGLIFTS),
  });
  await p.page.getByRole("alertdialog").getByRole("button", { name: "Import" }).click();
  await expect(p.page.getByText(/already here, skipped/)).toBeVisible();
  await expect(p.page.getByText(/^\d+ workouts? · \d+ sets/)).toHaveText(/^3 workout/);
});

test("a downloaded backup restores into a brand-new account", async ({ phone }) => {
  const old = await phone();
  await createAccount(old.page, "Isaac");
  await doWorkout(old.page);
  await openSettings(old.page);
  const download = old.page.waitForEvent("download");
  await old.page.getByRole("button", { name: /Download backup/ }).click();
  const file = await (await download).path();

  const fresh = await phone();
  await createAccount(fresh.page, "Isaac again");
  await openSettings(fresh.page);
  await fresh.page.getByLabel("Restore from backup file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: readFileSync(file),
  });
  await fresh.page.getByRole("alertdialog").getByRole("button", { name: /Replace/ }).click();
  await expect(fresh.page.getByText(/^\d+ workouts? · \d+ sets/)).toHaveText(/^1 workout/);
  await fresh.page.getByRole("navigation").getByRole("link", { name: "History" }).click();
  await expect(fresh.page.getByText("Workout A").first()).toBeVisible();
});
