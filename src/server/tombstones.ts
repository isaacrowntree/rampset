/** Which workouts the journal says are deleted.
 *
 * The log can't interpret payloads — that's what keeps `durable-sync` a
 * primitive rather than a database — so knowing what a `deleteWorkout` op
 * removed is our business, not its.
 *
 * R2's latest.json is merged by union so a device that's behind can't erase
 * rows it never saw. But union can only ever ADD, so without this a deleted
 * workout walks back in from whichever device still holds it. */

import type { StoredOp } from "durable-sync/server";

export const DELETE_WORKOUT = "deleteWorkout";

/** The workout ids a journal's `deleteWorkout` ops removed — pass it
 * `(await journal.opsByKind(DELETE_WORKOUT)).ops`. */
export function tombstonedWorkoutIds(ops: StoredOp[]): string[] {
  const ids = ops
    .map((o) => (o.payload as { workoutId?: unknown } | null)?.workoutId)
    .filter((id): id is string => typeof id === "string" && id !== "");
  return [...new Set(ids)];
}
