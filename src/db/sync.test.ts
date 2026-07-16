import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "./db";
import { seedIfEmpty } from "./seed";
import { setAccessIdentity } from "@/lib/identityGate";
import { startWorkout, logSet, finishWorkout } from "./session";
import {
  buildFinishedWorkoutOp,
  applyOp,
  deleteWorkoutOpId,
} from "./sync";

const USER1 = "user-1";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedIfEmpty();
  localStorage.clear();
  setAccessIdentity(null); // unresolved identity — the permissive default
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function finishRealWorkout(): Promise<string> {
  const day = await db.programDays.get("day-5x5-b-user-1");
  const s = await startWorkout(USER1, day!.id);
  const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
  for (let i = 0; i < 5; i++) {
    await logSet(s.workout.id, USER1, squat.exercise.id, i, { weightKg: 27.5, reps: 5 });
  }
  await finishWorkout(s.workout.id);
  return s.workout.id;
}

describe("buildFinishedWorkoutOp", () => {
  it("bundles the workout, its sets, and current working weights", async () => {
    const workoutId = await finishRealWorkout();
    const op = await buildFinishedWorkoutOp(workoutId);
    expect(op?.opId).toBe(workoutId);
    expect(op?.kind).toBe("finishedWorkout");
    const p = op!.payload;
    expect(p.workout.id).toBe(workoutId);
    expect(p.sets).toHaveLength(5);
    expect(p.weights.length).toBeGreaterThan(0);
  });

  it("returns null for unfinished or missing workouts", async () => {
    const day = await db.programDays.get("day-5x5-a-user-1");
    const s = await startWorkout(USER1, day!.id);
    expect(await buildFinishedWorkoutOp(s.workout.id)).toBeNull();
    expect(await buildFinishedWorkoutOp("nope")).toBeNull();
  });
});

/** applyOp is the half durable-sync cannot have: what an op MEANS here. The
 * library calls it and counts what it returns; everything below is ours. */
describe("applying a finished-workout op", () => {
  it("brings across the workout, its sets, and the progression it produced", async () => {
    const workoutId = await finishRealWorkout();
    const op = await buildFinishedWorkoutOp(workoutId);

    // Device B: fresh db, same seed.
    await db.delete();
    await db.open();
    await seedIfEmpty();

    expect(await applyOp(USER1, op!)).toBe(true);
    expect(await db.workouts.get(workoutId)).toBeDefined();
    expect(await db.sets.where({ workoutId }).count()).toBe(5);

    const pes = await db.programExercises
      .where({ programDayId: "day-5x5-b-user-1" })
      .sortBy("position");
    expect(pes[0].workingWeightKg).toBe(30); // squat B advanced
  });

  it("re-applying the same op changes nothing", async () => {
    const workoutId = await finishRealWorkout();
    const op = await buildFinishedWorkoutOp(workoutId);
    const before = await db.sets.count();

    expect(await applyOp(USER1, op!)).toBe(false); // already have it
    expect(await db.sets.count()).toBe(before);
  });

  it("never adopts the household's other user's workout", async () => {
    const workoutId = await finishRealWorkout();
    const op = await buildFinishedWorkoutOp(workoutId);
    op!.payload.workout.userId = "user-2";

    expect(await applyOp(USER1, op!)).toBe(false);
  });
});

describe("deleteWorkout op", () => {
  it("removes the workout, its sets, and rolls back the weight it advanced", async () => {
    const workoutId = await finishRealWorkout();
    expect(await db.sets.where({ workoutId }).count()).toBe(5);
    const pe = (await db.programExercises.where({ programDayId: "day-5x5-b-user-1" }).sortBy("position"))[0];
    expect(pe.workingWeightKg).toBe(30); // advanced by the workout

    const applied = await applyOp(USER1, {
      opId: `del:${workoutId}`,
      kind: "deleteWorkout",
      payload: { workoutId, weights: [{ programExerciseId: pe.id, workingWeightKg: 27.5 }] },
    } as never);

    expect(applied).toBe(true);
    expect(await db.workouts.get(workoutId)).toBeUndefined();
    expect(await db.sets.where({ workoutId }).count()).toBe(0);
    expect((await db.programExercises.get(pe.id))?.workingWeightKg).toBe(27.5);
  });

  // Delete-before-create is the normal ordering across devices: a device that
  // does not hold the workout yet must still remember the deletion, or the
  // workout walks back in the moment its finishedWorkout op arrives.
  it("records the tombstone even when the workout isn't here yet", async () => {
    const workoutId = await finishRealWorkout();
    const op = await buildFinishedWorkoutOp(workoutId);

    await db.delete();
    await db.open();
    await seedIfEmpty();

    // Delete arrives first, for a workout this device has never seen.
    const deleted = await applyOp(USER1, {
      opId: `del:${workoutId}`,
      kind: "deleteWorkout",
      payload: { workoutId },
    } as never);
    expect(deleted).toBe(true);

    // The create arrives afterwards and must NOT resurrect it.
    const recreated = await applyOp(USER1, op!);
    expect(recreated).toBe(false);
    expect(await db.workouts.get(workoutId)).toBeUndefined();
  });

  it("is idempotent — replaying the delete is harmless", async () => {
    const workoutId = await finishRealWorkout();
    const op = { opId: `del:${workoutId}`, kind: "deleteWorkout", payload: { workoutId } } as never;
    await applyOp(USER1, op);
    await expect(applyOp(USER1, op)).resolves.not.toThrow();
    expect(await db.workouts.get(workoutId)).toBeUndefined();
  });
});

/** Linked progression writes a lift's new weight to its slots on OTHER program
 * days too (squat is one ladder across A/B). The op has to carry what the
 * finish actually wrote, or the peer advances only the day it can see and the
 * two devices quietly disagree about the other one — which is the whole bug
 * class this journal exists to prevent. */
describe("linked progression crosses devices", () => {
  it("the peer ends up with the same weights as the author, on BOTH days", async () => {
    const sq = async (day: string) =>
      ((await db.programExercises.where({ programDayId: day }).sortBy("position"))[0])!
        .workingWeightKg;

    // Author finishes Workout B; linking advances squat on A and B.
    const s = await startWorkout(USER1, "day-5x5-b-user-1");
    const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
    const at = squat.targets[0]!.weightKg!;
    for (let i = 0; i < 5; i++) {
      await logSet(s.workout.id, USER1, squat.exercise.id, i, { weightKg: at, reps: 5 });
    }
    await finishWorkout(s.workout.id);

    const authorA = await sq("day-5x5-a-user-1");
    const authorB = await sq("day-5x5-b-user-1");
    expect(authorA).toBe(authorB); // linked, on the author

    const op = await buildFinishedWorkoutOp(s.workout.id);

    // Peer applies that op to a fresh device.
    await db.delete();
    await db.open();
    await seedIfEmpty();
    await applyOp(USER1, op!);

    expect(await sq("day-5x5-b-user-1")).toBe(authorB);
    expect(await sq("day-5x5-a-user-1")).toBe(authorA); // the sibling the op must carry
  });
});

/** A journal replay must land where the first pass landed.
 *
 * Replay is not exotic: autoRestoreIfEmpty restores from R2 and never sets the
 * cursor, so EVERY fresh device replays the whole journal from 0 onto a
 * snapshot that already reflects it. The epoch path replays by design too, and
 * has already run in production. */
describe("replaying the journal", () => {
  const peSquatA = async () =>
    ((await db.programExercises.where({ programDayId: "day-5x5-a-user-1" }).sortBy("position"))[0])!;

  const delOp = (peId: string, kg: number) =>
    ({
      opId: deleteWorkoutOpId("ghost"),
      kind: "deleteWorkout",
      payload: { workoutId: "ghost", weights: [{ programExerciseId: peId, workingWeightKg: kg }] },
    }) as never;

  const finishOp = (peId: string, kg: number) =>
    ({
      opId: "later-workout",
      kind: "finishedWorkout",
      payload: {
        workout: {
          id: "later-workout", userId: USER1, dayLabel: "Workout A", date: "2026-07-12",
          programDayId: "day-5x5-a-user-1", startTs: 1, endTs: 2,
        },
        sets: [], weights: [{ programExerciseId: peId, workingWeightKg: kg }], exercises: [],
      },
    }) as never;

  it("a delete then a finish converges on the finish's weight, and stays there", async () => {
    const pe = (await peSquatA()).id;

    await applyOp(USER1, delOp(pe, 25)); // rolls back
    await applyOp(USER1, finishOp(pe, 27.5)); // then corrects
    expect((await peSquatA()).workingWeightKg).toBe(27.5);

    // Replay the same two ops onto state that already reflects them.
    await applyOp(USER1, delOp(pe, 25));
    await applyOp(USER1, finishOp(pe, 27.5));
    expect((await peSquatA()).workingWeightKg).toBe(27.5);
  });

  /** GUARD. Working weight has writers that emit no op at all — the layoff
   * deload button, manual edits in /program, mid-workout edits. A replay must
   * not re-assert an op's stale snapshot over them. This passes today and is
   * exactly what "apply weights even when the workout exists" would break. */
  it("does not revert an un-journalled weight edit", async () => {
    const workoutId = await finishRealWorkout();
    const op = await buildFinishedWorkoutOp(workoutId);
    const pe = (await db.programExercises
      .where({ programDayId: "day-5x5-b-user-1" }).sortBy("position"))[0]!;

    // Hand edit, the way /program does it. No op exists for this.
    await db.programExercises.update(pe.id, { workingWeightKg: 42.5 });

    await applyOp(USER1, op!); // replay

    expect((await db.programExercises.get(pe.id))?.workingWeightKg).toBe(42.5);
  });

  /** GUARD. A tombstoned workout's finish op must not advance the weight —
   * the workout is gone, so the progression it claimed never happened. */
  it("does not advance the weight for a workout that was deleted", async () => {
    const pe = (await peSquatA()).id;
    const before = (await peSquatA()).workingWeightKg;

    await applyOp(USER1, {
      opId: deleteWorkoutOpId("later-workout"),
      kind: "deleteWorkout",
      payload: { workoutId: "later-workout" },
    } as never);
    await applyOp(USER1, finishOp(pe, 99));

    expect((await peSquatA()).workingWeightKg).toBe(before);
  });
});
