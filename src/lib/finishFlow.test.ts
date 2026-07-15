import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { db } from "@/db/db";
import { seedIfEmpty } from "@/db/seed";
import { startWorkout, logSet } from "@/db/session";
import { activeWorkoutKey } from "@/db/activeWorkout";
import { takeJustFinished } from "@/lib/justFinished";
import { completeWorkout } from "@/lib/finishFlow";

const USER1 = "user-1";
const EMAIL = "user1@example.com";

async function aLoggedWorkout() {
  const dayB = await db.programDays.get("day-5x5-b-user-1");
  const s = await startWorkout(USER1, dayB!.id);
  localStorage.setItem(activeWorkoutKey(USER1), s.workout.id);
  const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
  await logSet(s.workout.id, USER1, squat.exercise.id, 0, { weightKg: 27.5, reps: 5 });
  return s.workout.id;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedIfEmpty();
  localStorage.clear();
  sessionStorage.clear();
});

describe("completeWorkout", () => {
  it("navigates to History and marks the congrats WITHOUT waiting on the network", async () => {
    const workoutId = await aLoggedWorkout();
    const navigate = vi.fn();

    // Simulate a slow/dead connection: the background push never resolves.
    // The Finish flow must NOT block on it — this is exactly the bug where
    // hitting Finish "does nothing" until the request comes back.
    let pushStarted = false;
    const pushBackground = vi.fn(() => {
      pushStarted = true;
      return new Promise<void>(() => {}); // hangs forever
    });

    await completeWorkout(
      { userId: USER1, email: EMAIL, workoutId, workSets: 1, tonnageKg: 137.5 },
      { navigate, pushBackground },
    );

    // Navigation + congrats happened despite the hanging network.
    expect(navigate).toHaveBeenCalledWith("/history");
    expect(takeJustFinished()).toEqual({ workoutId, tonnageKg: 137.5 });
    // The active-workout pointer is cleared so Back can't restart it.
    expect(localStorage.getItem(activeWorkoutKey(USER1))).toBeNull();
    // The workout is queued for sync locally (guaranteed, no network needed),
    // so nothing is lost while the connection catches up.
    expect(await db.outbox.where({ userId: USER1 }).count()).toBe(1);
    // The background push was kicked off (and left running).
    expect(pushStarted).toBe(true);
  });

  // The workout is already committed to IndexedDB by this point. If queueing
  // it for sync fails, the flow must still celebrate and navigate — stranding
  // the user on the workout screen leaves the active-workout pointer cleared,
  // so the screen starts the NEXT workout and the finished one is never seen
  // again.
  it("still celebrates and navigates when the sync enqueue fails", async () => {
    const workoutId = await aLoggedWorkout();
    const navigate = vi.fn();
    const pushBackground = vi.fn();
    const enqueue = vi.fn(async () => {
      throw new Error("IndexedDB unavailable");
    });

    await completeWorkout(
      { userId: USER1, email: EMAIL, workoutId, workSets: 1, tonnageKg: 137.5 },
      { navigate, pushBackground, enqueue },
    );

    expect(navigate).toHaveBeenCalledWith("/history");
    expect(takeJustFinished()).toEqual({ workoutId, tonnageKg: 137.5 });
    // The workout itself survived — only the queueing failed.
    expect((await db.workouts.get(workoutId))?.endTs).toBeDefined();
    // And the push still runs, so the outbox gets another chance.
    expect(pushBackground).toHaveBeenCalled();
  });

  it("discards an empty workout and returns Home without a congrats", async () => {
    const dayB = await db.programDays.get("day-5x5-b-user-1");
    const s = await startWorkout(USER1, dayB!.id);
    localStorage.setItem(activeWorkoutKey(USER1), s.workout.id);
    const navigate = vi.fn();
    const pushBackground = vi.fn();

    await completeWorkout(
      { userId: USER1, email: EMAIL, workoutId: s.workout.id, workSets: 0, tonnageKg: 0 },
      { navigate, pushBackground },
    );

    expect(navigate).toHaveBeenCalledWith("/");
    expect(navigate).not.toHaveBeenCalledWith("/history");
    expect(takeJustFinished()).toBeNull();
    expect(pushBackground).not.toHaveBeenCalled();
    expect(localStorage.getItem(activeWorkoutKey(USER1))).toBeNull();
    // Empty workout discarded, not persisted.
    expect(await db.workouts.get(s.workout.id)).toBeUndefined();
  });
});
