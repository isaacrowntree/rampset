import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "./db";
import { seedIfEmpty } from "@/test/seed";
import { exportBackup, moveBackup, restoreBackup } from "./backup";

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

  // The re-seed path: a backup from an old account restored into a new one.
  // Rows are written verbatim and every query is scoped by userId, so the
  // file must be re-homed — restored as-is, nothing could ever read it.
  it("moves a backup from another account onto this one", async () => {
    await db.workouts.add({
      id: "w1", userId: USER1, dayLabel: "Workout A", date: "2026-01-01",
      programDayId: "day-5x5-a-user-1", prescribedSets: { "ex-user-1-squat": 5 },
    });
    await db.sets.add({
      id: "s1", workoutId: "w1", userId: USER1, exerciseId: "ex-user-1-squat",
      setIndex: 0, weightKg: 100, reps: 5, isWarmup: false,
    });
    const json = await exportBackup(USER1);

    // A brand-new account on a fresh device.
    await db.delete();
    await db.open();
    const summary = await restoreBackup("u_new", json);
    expect(summary.workouts).toBe(1);

    const [w] = await db.workouts.where({ userId: "u_new" }).toArray();
    expect(w).toMatchObject({ programDayId: "day-5x5-a-u_new", prescribedSets: { "ex-u_new-squat": 5 } });
    const [set] = await db.sets.where({ userId: "u_new" }).toArray();
    expect(await db.exercises.get(set.exerciseId)).toMatchObject({ name: "Squat", userId: "u_new" });
    expect(await db.programs.where({ userId: "u_new" }).count()).toBe(1);
    expect(await db.programExercises.get("pe-day-5x5-a-u_new-0")).toBeDefined();
    // Nothing is left stamped with the old owner.
    expect(JSON.stringify(await db.sets.toArray())).not.toContain("user-1");
  });

  it("replaces the destination account's own rows rather than mixing them in", async () => {
    await giveUser2History();
    await restoreBackup(USER2, await foreignBackupJson());
    expect(await db.workouts.get("w-user2-only")).toBeUndefined();
    expect(await db.workouts.where({ userId: USER1 }).count()).toBe(0);
  });
});

describe("restoring a file that isn't what it claims", () => {
  // Every row lands under the account restoring it, or the file is refused:
  // a row stamped for another profile would sit on this device and go up
  // with the next backup.
  it("refuses a file carrying another profile's rows", async () => {
    const data = JSON.parse(await exportBackup(USER1));
    data.workouts.push({ id: "planted", userId: USER2, dayLabel: "x", date: "2026-01-01", startTs: 1 });
    await expect(restoreBackup(USER1, JSON.stringify(data))).rejects.toThrow(/another account/);
    expect(await db.workouts.get("planted")).toBeUndefined();
  });

  it("refuses a damaged file without touching what's here", async () => {
    await giveUser2History();
    const data = JSON.parse(await exportBackup(USER2));
    data.sets = "nope";
    await expect(restoreBackup(USER2, JSON.stringify(data))).rejects.toThrow(/damaged/);
    expect(await db.workouts.get("w-user2-only")).toBeDefined();
  });

  it("drops program structure and sets that hang off nothing in the file", async () => {
    const data = JSON.parse(await exportBackup(USER1));
    data.programDays.push({ id: "orphan-day", programId: "not-in-file" });
    data.sets.push({ id: "orphan-set", userId: USER1, workoutId: "not-in-file" });
    await restoreBackup(USER1, JSON.stringify(data));
    expect(await db.programDays.get("orphan-day")).toBeUndefined();
    expect(await db.sets.get("orphan-set")).toBeUndefined();
  });

  it("from the cloud, refuses another account's snapshot outright", async () => {
    const data = JSON.parse(await exportBackup(USER1));
    await expect(restoreBackup("u_me", JSON.stringify({ ...data, userId: "u_someone" }), { fromCloud: true })).rejects.toThrow(
      /different account/,
    );
  });
});

describe("moveBackup", () => {
  it("rewrites the owner only as a whole id segment", () => {
    const moved = moveBackup(
      {
        format: "liftlog-backup", version: 1, exportedAt: "", userId: "user-1",
        exercises: [{ id: "ex-user-1-squat", userId: "user-1" }, { id: "ex-user-10-squat", userId: "user-10" }],
        programs: [], programDays: [], programExercises: [], workouts: [], sets: [],
      },
      "u_new",
    );
    expect(moved.exercises.map((e) => (e as { id: string }).id)).toEqual(["ex-u_new-squat", "ex-user-10-squat"]);
  });
});
