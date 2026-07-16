/** Which workouts the journal says are deleted.
 *
 * The log can't interpret payloads — that's what keeps `durable-sync` a
 * primitive rather than a database — so knowing what a `deleteWorkout` op
 * removed is our business, not its.
 *
 * R2's latest.json is merged by union so a device that's behind can't erase
 * rows it never saw. But union can only ever ADD, so without this a deleted
 * workout walks back in from whichever device still holds it. */

import { handleOpsByKind, type OpStore } from "durable-sync/server";

export const DELETE_WORKOUT = "deleteWorkout";

export function handleTombstones(store: OpStore): { workoutIds: string[] } {
  const ids = handleOpsByKind(store, DELETE_WORKOUT)
    .ops.map((o) => (o.payload as { workoutId?: unknown } | null)?.workoutId)
    .filter((id): id is string => typeof id === "string" && id !== "");
  return { workoutIds: [...new Set(ids)] };
}
