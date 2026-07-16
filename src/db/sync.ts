"use client";

/** What our ops MEAN.
 *
 * The transport — outbox, cursor, epochs, lifecycle triggers — is durable-sync;
 * see syncFor.ts, which wires it to this app. What lives here is the half no
 * sync library can have: the shape of our ops, and what applying one does to
 * this database.
 *
 * Unit of sync: one FINISHED workout — the workout row, its sets, and the
 * working weights it produced. Ops are idempotent; opId is the workout id. */

import { db } from "./db";
import type { Exercise, SetEntry, Workout } from "@/lib/types";

/** A slot's progression state as the author left it. `sets`/`deloadCount` are
 * optional so ops written before they were carried still apply. */
export interface WeightUpdate {
  programExerciseId: string;
  workingWeightKg: number;
  sets?: number;
  deloadCount?: number;
}

export interface FinishedWorkoutPayload {
  workout: Workout;
  sets: SetEntry[];
  weights: WeightUpdate[];
  /** Exercises the sets reference — upserted on apply so ops from a device
   * with imported/custom exercises resolve everywhere. */
  exercises: Exercise[];
}

/** Undo a workout that should never have been recorded. `weights` rolls back
 * the progression it advanced — deleting the history without it would leave
 * the program prescribing a weight nothing in the log justifies. */
export interface DeleteWorkoutPayload {
  workoutId: string;
  weights?: WeightUpdate[];
}

export interface FinishedWorkoutOp {
  opId: string;
  kind: "finishedWorkout";
  payload: FinishedWorkoutPayload;
}
export interface DeleteWorkoutOp {
  opId: string;
  kind: "deleteWorkout";
  payload: DeleteWorkoutPayload;
}
export type SyncOp = FinishedWorkoutOp | DeleteWorkoutOp;

/** The journal has no delete primitive, so a deletion is itself an op. Keyed
 * distinctly from the workout's own opId, which is the bare workout id. */
export function deleteWorkoutOpId(workoutId: string): string {
  return `del:${workoutId}`;
}

/** Snapshot a finished workout into a sync op. Null for unfinished/missing. */
export async function buildFinishedWorkoutOp(
  workoutId: string,
): Promise<FinishedWorkoutOp | null> {
  const workout = await db.workouts.get(workoutId);
  if (!workout || workout.endTs === undefined) return null;
  const sets = await db.sets.where({ workoutId }).toArray();

  // Every slot the finish touched — not just the finished day's.
  //
  // Linked progression writes a lift's new weight to its slots on OTHER days
  // (squat is one ladder across A/B), so carrying only this day's slots means
  // the peer advances the day it can see and silently keeps a stale weight on
  // the day it can't. Scope to the whole program: it's ~10 rows, and the op
  // should assert exactly what the author ended up with.
  const weights: FinishedWorkoutPayload["weights"] = [];
  if (workout.programDayId) {
    const day = await db.programDays.get(workout.programDayId);
    const dayIds = day
      ? (await db.programDays.where({ programId: day.programId }).toArray()).map((d) => d.id)
      : [workout.programDayId];
    const pes = await db.programExercises.where("programDayId").anyOf(dayIds).toArray();
    for (const pe of pes) {
      if (pe.workingWeightKg === undefined) continue;
      weights.push({
        programExerciseId: pe.id,
        workingWeightKg: pe.workingWeightKg,
        // The stall protocol drops 5×5 → 3×5 → 1×5 and counts deloads. Without
        // these the peer keeps prescribing volume the author already cut.
        sets: pe.sets,
        deloadCount: pe.deloadCount,
      });
    }
  }
  const exerciseIds = [...new Set(sets.map((s) => s.exerciseId))];
  const exercises = (await db.exercises.bulkGet(exerciseIds)).filter(
    (e): e is Exercise => e !== undefined,
  );

  return {
    opId: workout.id,
    kind: "finishedWorkout",
    payload: { workout, sets, weights, exercises },
  };
}

/** Queue a finished workout. Local and durable — no network — so it is safe to
 * await on the finish path, and it is what guarantees nothing is lost when the
 * push has no connection. */
export async function enqueueFinishedWorkout(
  userId: string,
  workoutId: string,
): Promise<void> {
  const op = await buildFinishedWorkoutOp(workoutId);
  if (!op) return;
  const user = await db.users.get(userId);
  if (!user) return;
  // Imported lazily: this module is the op vocabulary, and syncFor imports it.
  const { syncFor } = await import("@/lib/syncFor");
  await syncFor(user).enqueue(op);
}

/** Apply one journal op to this device. Existing workouts are never touched. */
export async function applyOp(userId: string, op: SyncOp): Promise<boolean> {
  if (op.kind === "deleteWorkout") return applyDeleteWorkout(userId, op.payload);
  if (op.kind !== "finishedWorkout") return false;

  const { workout, sets, weights, exercises } = op.payload;
  // The journal is per-Access-identity but the avatar switcher means an op can
  // legitimately belong to the household's other user. Never adopt it.
  if (workout.userId !== userId) return false;

  let created = false;
  await db.transaction(
    "rw",
    [db.workouts, db.sets, db.programExercises, db.exercises, db.tombstones],
    async () => {
      // Both checks live INSIDE the transaction: two tabs share one
      // IndexedDB, so a check outside it races a concurrent delete and
      // resurrects the workout.
      if (await db.tombstones.get(workout.id)) return;
      if (await db.workouts.get(workout.id)) return;

      for (const ex of exercises ?? []) {
        if (!(await db.exercises.get(ex.id))) await db.exercises.put(ex);
      }
      await db.workouts.put(workout);
      if (sets.length) await db.sets.bulkPut(sets);
      for (const w of weights) await applyWeight(w);
      created = true;
    },
  );
  return created;
}

async function applyDeleteWorkout(
  userId: string,
  payload: DeleteWorkoutPayload,
): Promise<boolean> {
  const { workoutId, weights } = payload;
  if (!workoutId) return false;

  await db.transaction(
    "rw",
    [db.workouts, db.sets, db.programExercises, db.tombstones, db.outbox],
    async () => {
      // Have we already applied THIS delete? The tombstone is written in this
      // same transaction, so its absence is exactly "first sight" — there is
      // no window where one is true and the other isn't.
      const firstSight = !(await db.tombstones.get(workoutId));

      // Recorded unconditionally — including when we don't hold the workout.
      // Delete-before-create is the normal cross-device ordering, and without
      // the tombstone the workout walks back in when its create op arrives.
      await db.tombstones.put({ workoutId, userId, deletedAt: Date.now() });
      await db.sets.where({ workoutId }).delete();
      await db.workouts.delete(workoutId);
      // Don't re-push a workout we've just been told to forget.
      await db.outbox.where({ opId: workoutId }).delete();

      // Roll back the progression this workout advanced — but only once.
      // Deleting rows is naturally idempotent; rolling a weight back is not.
      // On a replay the weight has moved on — a later op corrected it, or the
      // lifter edited it by hand — and re-asserting a rollback from the past
      // would silently undo that. Replay must land where the first pass landed.
      if (firstSight) for (const w of weights ?? []) await applyWeight(w);
    },
  );
  return true;
}

/** Mirror one slot's progression state. Only fields the op actually carried
 * are written, so an op from before `sets`/`deloadCount` existed is still a
 * valid weight-only update rather than a reset to undefined. */
async function applyWeight(w: WeightUpdate): Promise<void> {
  const pe = await db.programExercises.get(w.programExerciseId);
  if (!pe) return;
  const patch: { workingWeightKg: number; sets?: number; deloadCount?: number } = {
    workingWeightKg: w.workingWeightKg,
  };
  if (w.sets !== undefined) patch.sets = w.sets;
  if (w.deloadCount !== undefined) patch.deloadCount = w.deloadCount;
  await db.programExercises.update(pe.id, patch);
}
