import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "./db";
import { seedIfEmpty } from "./seed";
import { exportBackup, restoreBackup } from "./backup";

const USER1 = "user-1";
const USER2 = "user-2";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedIfEmpty();
});

async function giveUser2History(): Promise<void> {
  await db.workouts.add({
    id: "w-user2-only",
    userId: USER2,
    dayLabel: "Day 1",
    date: "2026-01-01",
    startTs: 1,
    endTs: 2,
  });
}

/** user-1's backup with every row id rewritten so nothing collides with
 * user-2's seeded rows.
 *
 * This matters: with COLLIDING ids a cross-user restore happens to blow up on
 * a bulkAdd ConstraintError and Dexie rolls the wipe back — which makes a
 * naive `rejects.toThrow()` pass while the real defect is untouched. Only
 * non-colliding ids expose it. */
async function foreignBackupJson(): Promise<string> {
  let json = await exportBackup(USER1);
  const data = JSON.parse(json) as Record<string, Array<{ id: string }>>;
  const ids = [
    ...data.exercises,
    ...data.programs,
    ...data.programDays,
    ...data.programExercises,
    ...data.workouts,
    ...data.sets,
  ].map((r) => r.id);
  // Whole quoted strings only, so foreign keys are rewritten with their
  // targets and `userId: "user-1"` is left alone.
  for (const id of ids) json = json.replaceAll(`"${id}"`, `"x-${id}"`);
  return json;
}

describe("restoreBackup", () => {
  it("round-trips the same user's own backup", async () => {
    const json = await exportBackup(USER1);
    const summary = await restoreBackup(USER1, json);
    expect(summary.workouts).toBe(0);
    expect(await db.programs.where({ userId: USER1 }).count()).toBeGreaterThan(0);
  });

  // The file says user-1; the active user is user-2. Today restoreBackup
  // never looks at data.userId: it wipes the ACTIVE user's rows, then
  // bulkAdds the file's rows verbatim — still stamped user-1, so no query
  // ever reads them again — and returns a success summary. Total silent loss.
  it("refuses a backup belonging to a different user, leaving data intact", async () => {
    await giveUser2History();
    const json = await foreignBackupJson();

    await expect(restoreBackup(USER2, json)).rejects.toThrow(/different user/i);

    // user-2's history survived the refusal.
    expect(await db.workouts.where({ userId: USER2 }).count()).toBe(1);
    // and nothing grafted itself in under user-1's name.
    expect(await db.workouts.where({ userId: USER1 }).count()).toBe(0);
  });
});
