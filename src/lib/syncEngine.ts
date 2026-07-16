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
import { mayWriteAs } from "@/lib/identityGate";

/** One foregrounding fires visibilitychange + focus + pageshow together.
 * Collapse that burst into a single sync. */
export const MIN_INTERVAL_MS = 10_000;

const UNREACHABLE = "Couldn't reach the sync journal";

/** Module scope, not a ref: every caller must share one in-flight sync. */
let inFlight: Promise<number> | null = null;
let lastRunAt = 0;

export interface SyncDeps {
  flush?: typeof flushOutbox;
  pull?: typeof pullAndApply;
  activeWorkout?: typeof getActiveWorkout;
  now?: () => number;
  mayWrite?: typeof mayWriteAs;
}

/** Tests only — the module-level state is deliberately shared otherwise. */
export function resetSyncEngine(): void {
  inFlight = null;
  lastRunAt = 0;
  snapshots.clear();
  listeners.clear();
}

/** Survives reloads so "last synced" is still true after a cold launch.
 *
 * Per-user, like the cursor and the epoch. A single global key meant the
 * household's other avatar read a "Synced 2 minutes ago" it had no part in —
 * the one thing this row exists to never do. */
export function syncStateKey(userId: string): string {
  return `liftlog.syncState.${userId}`;
}

export interface SyncState {
  /** When we last reached the journal. Absent = never, on this device. */
  lastOkAt?: number;
  /** Why the last attempt didn't land. Absent = the last attempt was fine. */
  lastError?: string;
}

/** Sync state is external mutable state — it changes from timers and page
 * lifecycle events, not from rendering. Rather than mirror it into a store,
 * expose the subscribe/getSnapshot pair React's useSyncExternalStore wants.
 * getSnapshot MUST return a stable reference between changes or React spins. */
const listeners = new Set<() => void>();

function loadPersisted(userId: string): SyncState {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(syncStateKey(userId)) ?? "{}") as SyncState;
  } catch {
    return {};
  }
}

/** One snapshot per user, cached so the reference is stable between changes. */
const snapshots = new Map<string, SyncState>();

export function subscribeSyncState(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function readSyncState(userId: string): SyncState {
  let snapshot = snapshots.get(userId);
  if (!snapshot) {
    snapshot = loadPersisted(userId);
    snapshots.set(userId, snapshot);
  }
  return snapshot;
}

/** Nothing has synced during SSR, and this must be referentially stable. */
const SERVER_SNAPSHOT: SyncState = {};
export function readServerSyncState(): SyncState {
  return SERVER_SNAPSHOT;
}

function recordSyncState(userId: string, next: SyncState): void {
  snapshots.set(userId, next);
  try {
    localStorage.setItem(syncStateKey(userId), JSON.stringify(next));
  } catch {
    // private mode — losing the status row is not worth failing a sync over
  }
  for (const l of listeners) l();
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
    mayWrite = mayWriteAs,
  } = deps;

  // Syncing someone else's avatar under this Access session would file their
  // workouts in our journal — permanently, since the log is append-only.
  //
  // Say so. Returning quietly left the row showing a stale "Synced 2 minutes
  // ago" for a device that is not syncing and never will until the user
  // switches back — the exact silence this row exists to break.
  if (!mayWrite(email)) {
    recordSyncState(userId, {
      ...readSyncState(userId),
      lastError: "Signed in as a different user",
    });
    return 0;
  }
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
    const pushed = await flush(userId, email);
    if (await activeWorkout(userId)) {
      // Mid-workout: a clean push is as synced as we can honestly claim.
      recordSyncState(
        userId,
        pushed.ok
          ? { lastOkAt: now() }
          : { ...readSyncState(userId), lastError: UNREACHABLE },
      );
      return 0;
    }
    const pulled = await pull(userId, email);
    recordSyncState(
      userId,
      pushed.ok && pulled.ok
        ? { lastOkAt: now() }
        : { ...readSyncState(userId), lastError: UNREACHABLE },
    );
    return pulled.applied;
  })();

  try {
    return await inFlight;
  } finally {
    lastRunAt = now();
    inFlight = null;
  }
}
