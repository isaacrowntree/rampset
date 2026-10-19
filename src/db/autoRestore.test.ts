import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { db } from "./db";
import { seedIfEmpty } from "@/test/seed";
import { startWorkout, logSet, finishWorkout } from "./session";
import { exportBackup } from "./backup";
import { autoRestoreIfEmpty } from "./autoRestore";

const USER1 = "user-1";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedIfEmpty();
});

async function makeCloudSnapshot(): Promise<string> {
  const day = await db.programDays.get("day-5x5-b-user-1");
  const s = await startWorkout(USER1, day!.id);
  const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
  for (let i = 0; i < 5; i++) {
    await logSet(s.workout.id, USER1, squat.exercise.id, i, { weightKg: 27.5, reps: 5 });
  }
  await finishWorkout(s.workout.id);
  const json = await exportBackup(USER1);
  // wipe to simulate a brand-new device
  await db.delete();
  await db.open();
  await seedIfEmpty();
  return json;
}

describe("autoRestoreIfEmpty (populate a fresh device from R2)", () => {
  it("restores the cloud snapshot onto an empty device", async () => {
    const snapshot = await makeCloudSnapshot();
    const summary = await autoRestoreIfEmpty(USER1, async () => snapshot);
    expect(summary?.workouts).toBe(1);
    expect(await db.workouts.where({ userId: USER1 }).count()).toBe(1);
    // program state came along: squat advanced to 30 in the snapshot
    const pes = await db.programExercises
      .where({ programDayId: "day-5x5-b-user-1" })
      .sortBy("position");
    expect(pes[0].workingWeightKg).toBe(30);
  });

  it("never touches a device that already has workouts", async () => {
    const snapshot = await makeCloudSnapshot();
    // device logs its own workout first
    const day = await db.programDays.get("day-5x5-a-user-1");
    const s = await startWorkout(USER1, day!.id);
    const first = s.exercises[0];
    await logSet(s.workout.id, USER1, first.exercise.id, 0, { weightKg: 25, reps: 5 });
    await finishWorkout(s.workout.id);

    const fetcher = vi.fn(async () => snapshot);
    const summary = await autoRestoreIfEmpty(USER1, fetcher);
    expect(summary).toBeNull();
    expect(fetcher).not.toHaveBeenCalled(); // doesn't even ask the network
  });

  it("does nothing when the cloud has no snapshot", async () => {
    const summary = await autoRestoreIfEmpty(USER1, async () => null);
    expect(summary).toBeNull();
  });

  it("survives a corrupt snapshot without wrecking the device", async () => {
    const summary = await autoRestoreIfEmpty(USER1, async () => "not json at all");
    expect(summary).toBeNull();
    // seeded program still intact
    expect(await db.programs.where({ userId: USER1 }).count()).toBe(1);
  });

  it("only restores the requested user's slot", async () => {
    const snapshot = await makeCloudSnapshot();
    await autoRestoreIfEmpty(USER1, async () => snapshot);
    expect(await db.workouts.where({ userId: "user-2" }).count()).toBe(0);
  });
});
