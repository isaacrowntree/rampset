import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  syncNow,
  resetSyncEngine,
  readSyncState,
  subscribeSyncState,
  syncStateKey,
  MIN_INTERVAL_MS,
} from "./syncEngine";
import type { Workout } from "@/lib/types";

const USER1 = "user-1";
const EMAIL = "user1@example.com";

function deps(over: Partial<Parameters<typeof syncNow>[2]> = {}) {
  return {
    flush: vi.fn(async () => ({ ok: true })),
    pull: vi.fn(async () => ({ ok: true, applied: 1 })),
    activeWorkout: vi.fn(async (): Promise<Workout | undefined> => undefined),
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear(); // before the reset — it reloads the snapshot from here
  resetSyncEngine();
});

describe("syncNow", () => {
  it("pushes and pulls when nothing is in progress", async () => {
    const d = deps();
    const applied = await syncNow(USER1, EMAIL, d);
    expect(d.flush).toHaveBeenCalledWith(USER1, EMAIL);
    expect(d.pull).toHaveBeenCalledWith(USER1, EMAIL);
    expect(applied).toBe(1);
  });

  // Pulling mid-workout rewrites programExercises.workingWeightKg, and
  // finishWorkout reads that back to decide whether a deload is due — so an
  // incoming op can silently drop a 5×5 to 3×5 under the lifter. Pushing is
  // always safe. The other device isn't mid-workout, so waiting costs nothing.
  it("pushes but never pulls while a workout is in progress", async () => {
    const d = deps({
      activeWorkout: vi.fn(async () => ({ id: "w1", userId: USER1 }) as Workout),
    });

    const applied = await syncNow(USER1, EMAIL, d);

    expect(d.flush).toHaveBeenCalledOnce();
    expect(d.pull).not.toHaveBeenCalled();
    expect(applied).toBe(0);
  });

  // The journal is keyed by the Access session but the ops carry the selected
  // avatar's rows, and the log is append-only — so one tap on the switcher
  // would file someone else's workouts in your journal forever.
  it("refuses to sync an avatar that isn't the signed-in identity, and says so", async () => {
    const d = deps({ mayWrite: () => false });

    const applied = await syncNow(USER1, EMAIL, d);

    expect(d.flush).not.toHaveBeenCalled();
    expect(d.pull).not.toHaveBeenCalled();
    expect(applied).toBe(0);
    // Not silent: the row must not keep claiming success.
    expect(readSyncState(USER1).lastError).toBeTruthy();
  });

  // A single iOS foregrounding fires visibilitychange + focus + pageshow.
  it("collapses overlapping calls into one sync", async () => {
    const d = deps();
    await Promise.all([
      syncNow(USER1, EMAIL, d),
      syncNow(USER1, EMAIL, d),
      syncNow(USER1, EMAIL, d),
    ]);
    expect(d.flush).toHaveBeenCalledOnce();
  });

  it("throttles a burst of triggers that arrive back to back", async () => {
    let t = 1_000_000;
    const d = deps({ now: () => t });
    await syncNow(USER1, EMAIL, d);
    t += 1_000; // 1s later — same foregrounding
    await syncNow(USER1, EMAIL, d);
    expect(d.flush).toHaveBeenCalledOnce();
  });

  it("syncs again once the throttle window has passed", async () => {
    let t = 1_000_000;
    const d = deps({ now: () => t });
    await syncNow(USER1, EMAIL, d);
    t += MIN_INTERVAL_MS + 1;
    await syncNow(USER1, EMAIL, d);
    expect(d.flush).toHaveBeenCalledTimes(2);
  });
});

/** Every failure path used to be swallowed, so "synced" and "silently broken
 * for a week" looked identical. The status row is only worth having if it
 * cannot claim success it didn't have. */
describe("sync status", () => {
  it("records when the journal was last reached", async () => {
    const d = deps({ now: () => 1_700_000 });
    await syncNow(USER1, EMAIL, d);
    expect(readSyncState(USER1).lastOkAt).toBe(1_700_000);
    expect(readSyncState(USER1).lastError).toBeUndefined();
  });

  it("does not claim success when the push failed", async () => {
    const d = deps({ flush: vi.fn(async () => ({ ok: false })) });
    await syncNow(USER1, EMAIL, d);
    expect(readSyncState(USER1).lastOkAt).toBeUndefined();
    expect(readSyncState(USER1).lastError).toBeTruthy();
  });

  it("does not claim success when the pull failed", async () => {
    const d = deps({ pull: vi.fn(async () => ({ ok: false, applied: 0 })) });
    await syncNow(USER1, EMAIL, d);
    expect(readSyncState(USER1).lastOkAt).toBeUndefined();
    expect(readSyncState(USER1).lastError).toBeTruthy();
  });

  it("keeps the last good time when a later attempt fails", async () => {
    let t = 1_700_000;
    await syncNow(USER1, EMAIL, deps({ now: () => t }));
    t += MIN_INTERVAL_MS + 1;
    await syncNow(USER1, EMAIL, deps({ now: () => t, pull: vi.fn(async () => ({ ok: false, applied: 0 })) }));

    const s = readSyncState(USER1);
    expect(s.lastOkAt).toBe(1_700_000); // still true — it DID sync then
    expect(s.lastError).toBeTruthy();
  });
});

/** The Settings row reads this through useSyncExternalStore, which demands a
 * referentially-stable snapshot between changes — return a fresh object each
 * call and React re-renders forever. */
describe("sync state as an external store", () => {
  it("returns a stable snapshot reference until something changes", async () => {
    const a = readSyncState(USER1);
    expect(readSyncState(USER1)).toBe(a);

    await syncNow(USER1, EMAIL, deps({ now: () => 1_700_000 }));

    const b = readSyncState(USER1);
    expect(b).not.toBe(a);
    expect(readSyncState(USER1)).toBe(b);
  });

  it("notifies subscribers when a sync lands, and stops after unsubscribe", async () => {
    const seen = vi.fn();
    const unsubscribe = subscribeSyncState(seen);

    await syncNow(USER1, EMAIL, deps({ now: () => 1_700_000 }));
    expect(seen).toHaveBeenCalledTimes(1);

    unsubscribe();
    resetSyncEngine();
    await syncNow(USER1, EMAIL, deps({ now: () => 1_800_000 }));
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

/** Cursor and epoch are per-user; sync state was not. With two avatars on one
 * device, user B read user A's "Synced 2 minutes ago" having never synced —
 * which is the exact thing the status row exists to prevent. */
describe("sync state is per-user", () => {
  const USER2 = "user-2";

  it("does not show one avatar the other's last-synced time", async () => {
    await syncNow(USER1, EMAIL, deps({ now: () => 1_000_000 }));

    expect(readSyncState(USER1).lastOkAt).toBe(1_000_000);
    expect(readSyncState(USER2).lastOkAt).toBeUndefined();
  });

  it("gives each user a distinct storage key", () => {
    expect(syncStateKey(USER1)).not.toBe(syncStateKey(USER2));
    expect(syncStateKey(USER1)).toContain(USER1);
  });

  it("keeps a stable snapshot reference per user", async () => {
    const a = readSyncState(USER1);
    expect(readSyncState(USER1)).toBe(a);          // useSyncExternalStore spins otherwise
    expect(readSyncState(USER2)).not.toBe(a);      // ...but not shared across users
  });
});
