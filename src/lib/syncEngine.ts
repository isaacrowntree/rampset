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
  snapshot = loadPersisted();
  listeners.clear();
}

/** Survives reloads so "last synced" is still true after a cold launch. */
export const SYNC_STATE_KEY = "liftlog.syncState";

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

function loadPersisted(): SyncState {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(SYNC_STATE_KEY) ?? "{}") as SyncState;
  } catch {
    return {};
  }
}

let snapshot: SyncState = loadPersisted();

export function subscribeSyncState(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function readSyncState(): SyncState {
  return snapshot;
}

/** Nothing has synced during SSR, and this must be referentially stable. */
const SERVER_SNAPSHOT: SyncState = {};
export function readServerSyncState(): SyncState {
  return SERVER_SNAPSHOT;
}

function recordSyncState(next: SyncState): void {
  snapshot = next;
  try {
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(next));
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
  if (!mayWrite(email)) return 0;
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
        pushed.ok
          ? { lastOkAt: now() }
          : { ...readSyncState(), lastError: "Couldn't reach the sync journal" },
      );
      return 0;
    }
    const pulled = await pull(userId, email);
    recordSyncState(
      pushed.ok && pulled.ok
        ? { lastOkAt: now() }
        : { ...readSyncState(), lastError: "Couldn't reach the sync journal" },
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
