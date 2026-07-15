"use client";

/** Keeps a device converged with the journal without the user thinking about
 * it.
 *
 * One sync per mount was never enough. An iOS home-screen PWA is frozen and
 * restored rather than remounted, so its mount effect can go days without
 * running again — you finish a workout in one view and the other never learns
 * about it. Every foregrounding is the real sync opportunity; mount is just
 * one of them (it still fires, because iOS cold-launches the PWA whenever the
 * saved context is evicted). */

import { flushOutbox, pullAndApply } from "@/db/sync";
import { getActiveWorkout } from "@/db/activeWorkout";

/** One foregrounding fires visibilitychange + focus + pageshow together.
 * Collapse that burst into a single sync. */
export const MIN_INTERVAL_MS = 10_000;

/** Module scope, not a ref: every caller must share one in-flight sync. */
let inFlight: Promise<number> | null = null;
let lastRunAt = 0;

export interface SyncDeps {
  flush?: typeof flushOutbox;
  pull?: typeof pullAndApply;
  activeWorkout?: typeof getActiveWorkout;
  now?: () => number;
}

/** Tests only — the module-level state is deliberately shared otherwise. */
export function resetSyncEngine(): void {
  inFlight = null;
  lastRunAt = 0;
}

/** Push, then pull unless a workout is open. Returns workouts applied.
 * Never throws: both halves already treat failure as "try again later". */
export async function syncNow(
  userId: string,
  email: string,
  deps: SyncDeps = {},
): Promise<number> {
  const {
    flush = flushOutbox,
    pull = pullAndApply,
    activeWorkout = getActiveWorkout,
    now = Date.now,
  } = deps;

  if (inFlight) return inFlight;
  if (now() - lastRunAt < MIN_INTERVAL_MS) return 0;
  // navigator.onLine is only trustworthy as a negative — a gym dead zone with
  // full bars still reports true — so it's worth exactly this one check.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;

  inFlight = (async () => {
    // Pushing is always safe. PULLING mid-workout is not: applyOp rewrites
    // programExercises.workingWeightKg, and finishWorkout reads it back to
    // decide deloads — an op landing mid-session can silently drop a 5×5 to
    // 3×5. The other device isn't mid-workout, so waiting costs nothing.
    await flush(userId, email);
    if (await activeWorkout(userId)) return 0;
    return pull(userId, email);
  })();

  try {
    return await inFlight;
  } finally {
    lastRunAt = now();
    inFlight = null;
  }
}
