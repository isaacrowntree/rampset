"use client";

/** Wrapping up a workout, split so the UI never waits on the network.
 *
 * The freeze this fixes: on a slow/dead connection, awaiting the cloud
 * push (or even the dynamic import of its chunk) before navigating left the
 * Finish modal sitting there doing nothing. The DB is the source of truth the
 * instant `finishWorkout` commits, so we celebrate + navigate immediately and
 * let sync catch up in the background. */

import { finishWorkout } from "@/db/session";
import { enqueueFinishedWorkout } from "@/db/sync";
import { activeWorkoutKey } from "@/db/activeWorkout";
import { markJustFinished } from "@/lib/justFinished";

export interface CompleteWorkoutArgs {
  userId: string;
  email: string;
  workoutId: string;
  /** Work sets logged — 0 means an empty workout, discarded, no congrats. */
  workSets: number;
  /** Σ weight × reps, for the History congrats banner. */
  tonnageKg: number;
}

export interface CompleteWorkoutDeps {
  navigate: (path: string) => void;
  /** Best-effort network push (flush the outbox + cloud backup). Kicked off
   * AFTER navigation and never awaited, so a slow connection can't stall the
   * Finish flow. Overridable for tests. */
  pushBackground?: (userId: string, email: string) => void;
  /** Queue the finished workout for sync. Overridable for tests. */
  enqueue?: (userId: string, workoutId: string) => Promise<void>;
}

/** Flush the sync outbox and snapshot to the cloud. Chunk imports and the
 * requests themselves can hang on a gym connection, so this only ever runs
 * detached from the UI. */
function defaultPushBackground(userId: string, email: string): void {
  void (async () => {
    const [{ syncFor }, { backupToCloud }, { db }] = await Promise.all([
      import("@/lib/syncFor"),
      import("@/lib/cloudBackup"),
      import("@/db/db"),
    ]);
    const user = await db.users.get(userId);
    // `force` skips the throttle: the throttle exists to collapse a
    // foregrounding burst, not to make a just-finished workout wait 10s.
    // It does NOT skip the identity gate — nothing does.
    if (user) void syncFor(user).now({ force: true }).catch(() => {});
    void backupToCloud(userId, email).catch(() => {});
  })().catch(() => {});
}

export async function completeWorkout(
  args: CompleteWorkoutArgs,
  deps: CompleteWorkoutDeps,
): Promise<void> {
  const { userId, email, workoutId, workSets, tonnageKg } = args;
  const {
    navigate,
    pushBackground = defaultPushBackground,
    enqueue = enqueueFinishedWorkout,
  } = deps;

  // Local + fast (IndexedDB only). An empty workout is discarded here.
  await finishWorkout(workoutId);
  localStorage.removeItem(activeWorkoutKey(userId));

  if (workSets === 0) {
    navigate("/"); // nothing saved — nothing to celebrate
    return;
  }

  // Queue the finished workout for sync. This is local (no network), so it's
  // safe to await — it guarantees nothing is lost even if the push below never
  // gets a connection.
  //
  // If queueing itself fails the workout is still committed, so we carry on:
  // stranding the user here would leave the active-workout pointer cleared and
  // the screen would silently start the NEXT workout instead.
  try {
    await enqueue(userId, workoutId);
  } catch {
    // Not queued — the workout lives on locally until a later sync sweep
    // picks it up. Better than losing the congrats and the navigation.
  }

  // Celebrate + leave INSTANTLY, then let the network catch up in the
  // background.
  markJustFinished({ workoutId, tonnageKg });
  navigate("/history"); // Back must not restart a workout
  pushBackground(userId, email);
}
