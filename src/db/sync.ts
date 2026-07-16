"use client";

/** Device↔cloud sync over the per-user Durable Object journal.
 * Unit of sync: one FINISHED workout (workout row + its sets + the working
 * weights it produced). Ops are idempotent — opId is the workout id — and
 * queue in an outbox while offline. */

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

export function syncCursorKey(userId: string): string {
  return `liftlog.syncCursor.${userId}`;
}

/** Which generation of the journal our cursor belongs to. A cursor is only
 * meaningful against the log that issued it — see pullAndApply. */
export function syncEpochKey(userId: string): string {
  return `liftlog.syncEpoch.${userId}`;
}

function devHeaders(email: string): HeadersInit {
  return process.env.NODE_ENV === "development"
    ? { "x-liftlog-dev-user": email }
    : {};
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

export async function enqueueFinishedWorkout(
  userId: string,
  workoutId: string,
): Promise<void> {
  const op = await buildFinishedWorkoutOp(workoutId);
  if (!op) return;
  const existing = await db.outbox.where({ opId: op.opId }).count();
  if (existing > 0) return;
  await db.outbox.add({ userId, opId: op.opId, kind: op.kind, payload: op.payload });
}

/** Did this response actually come from the journal? An expired Cloudflare
 * Access session redirects to a same-origin login page, which fetch follows
 * and reports as a 200 — so `res.ok` alone is not evidence of anything. The
 * outbox holds the only copy of an unsynced workout, so it may only be
 * drained against a reply the journal demonstrably wrote. */
function isJournalAck(body: unknown): body is { seq: number; accepted: number } {
  return typeof (body as { seq?: unknown } | null)?.seq === "number";
}

/** Push everything queued for this user. Failures keep the queue intact.
 * `ok` distinguishes "the journal has it" from every silent failure — the
 * sync status row is only honest if this is. */
export async function flushOutbox(
  userId: string,
  email: string,
): Promise<{ ok: boolean }> {
  const rows = await db.outbox.where({ userId }).toArray();
  if (rows.length === 0) return { ok: true }; // nothing queued is not a failure
  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Makes Access answer an expired session with 401 rather than
        // handing us its login page dressed as a 200.
        "x-requested-with": "XMLHttpRequest",
        ...devHeaders(email),
      },
      body: JSON.stringify({
        ops: rows.map((r) => ({ opId: r.opId, kind: r.kind, payload: r.payload })),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false };
    if (!isJournalAck(await res.json().catch(() => null))) return { ok: false };
    await db.outbox.bulkDelete(rows.map((r) => r.id!));
    return { ok: true };
  } catch {
    // offline — the outbox flushes next time
    return { ok: false };
  }
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
      // Recorded unconditionally — including when we don't hold the workout.
      // Delete-before-create is the normal cross-device ordering, and without
      // the tombstone the workout walks back in when its create op arrives.
      await db.tombstones.put({ workoutId, userId, deletedAt: Date.now() });
      await db.sets.where({ workoutId }).delete();
      await db.workouts.delete(workoutId);
      // Don't re-push a workout we've just been told to forget.
      await db.outbox.where({ opId: workoutId }).delete();
      for (const w of weights ?? []) await applyWeight(w);
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

/** Pull ops after our cursor and apply them.
 * `ok` says we actually reached the journal; `applied` counts new workouts. */
export async function pullAndApply(
  userId: string,
  email: string,
): Promise<{ ok: boolean; applied: number }> {
  const since = Number(localStorage.getItem(syncCursorKey(userId)) ?? 0) || 0;

  interface PullBody {
    ops?: Array<SyncOp & { seq: number }>;
    seq?: number;
    epoch?: string;
  }
  const pull = async (from: number): Promise<PullBody | null> => {
    const res = await fetch(`/api/sync?since=${from}`, {
      headers: { "x-requested-with": "XMLHttpRequest", ...devHeaders(email) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const parsed = (await res.json().catch(() => null)) as PullBody | null;
    // Same reasoning as the outbox flush: an Access login page is a 200.
    return typeof parsed?.seq === "number" ? parsed : null;
  };

  try {
    let body = await pull(since);
    if (!body) return { ok: false, applied: 0 };

    // A cursor is only meaningful against the journal generation that issued
    // it. If the journal was rebuilt, our cursor points into a log that no
    // longer exists — usually PAST the new one, so `seq > cursor` matches
    // nothing and we'd silently never sync again. Replay from the start;
    // applyOp skips whatever we already hold, so it's cheap and safe.
    const epoch = body.epoch;
    if (epoch && epoch !== localStorage.getItem(syncEpochKey(userId))) {
      body = await pull(0);
      if (!body) return { ok: false, applied: 0 };
      localStorage.setItem(syncEpochKey(userId), epoch);
    }

    let applied = 0;
    for (const op of body.ops ?? []) {
      try {
        if (await applyOp(userId, op)) applied++;
      } catch {
        // One corrupt op must not strand every op behind it — and must not
        // pin the cursor here, or every later sync refetches the same op,
        // throws again, and never makes progress.
      }
    }
    localStorage.setItem(syncCursorKey(userId), String(body.seq));
    return { ok: true, applied };
  } catch {
    return { ok: false, applied: 0 };
  }
}
