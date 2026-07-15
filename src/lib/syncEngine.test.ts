import { describe, it, expect, beforeEach, vi } from "vitest";
import { syncNow, resetSyncEngine, MIN_INTERVAL_MS } from "./syncEngine";
import type { Workout } from "@/lib/types";

const USER1 = "user-1";
const EMAIL = "user1@example.com";

function deps(over: Partial<Parameters<typeof syncNow>[2]> = {}) {
  return {
    flush: vi.fn(async () => {}),
    pull: vi.fn(async () => 1),
    activeWorkout: vi.fn(async (): Promise<Workout | undefined> => undefined),
    ...over,
  };
}

beforeEach(() => {
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
