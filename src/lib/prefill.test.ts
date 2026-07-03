import { describe, it, expect } from "vitest";
import { prefillFromLastSession } from "./prefill";
import type { SetEntry } from "./types";

function set(partial: Partial<SetEntry> & { exerciseId: string; setIndex: number }): SetEntry {
  return {
    id: `${partial.exerciseId}-${partial.setIndex}-${partial.workoutId ?? "w1"}`,
    workoutId: "w1",
    userId: "silvana",
    isWarmup: false,
    ...partial,
  };
}

describe("prefillFromLastSession (routine mode)", () => {
  it("returns the last session's weight and reps per set index", () => {
    const history = [
      set({ exerciseId: "hipthrust", setIndex: 0, weightKg: 70, reps: 15, completedTs: 100 }),
      set({ exerciseId: "hipthrust", setIndex: 1, weightKg: 70, reps: 15, completedTs: 101 }),
      set({ exerciseId: "hipthrust", setIndex: 2, weightKg: 70, reps: 12, completedTs: 102 }),
    ];
    const prefill = prefillFromLastSession(history, "hipthrust", 3);
    expect(prefill).toEqual([
      { weightKg: 70, reps: 15 },
      { weightKg: 70, reps: 15 },
      { weightKg: 70, reps: 12 },
    ]);
  });

  it("uses only the most recent workout when several exist", () => {
    const history = [
      set({ workoutId: "old", exerciseId: "squat", setIndex: 0, weightKg: 30, reps: 10, completedTs: 100 }),
      set({ workoutId: "new", exerciseId: "squat", setIndex: 0, weightKg: 32, reps: 10, completedTs: 200 }),
    ];
    expect(prefillFromLastSession(history, "squat", 1)).toEqual([{ weightKg: 32, reps: 10 }]);
  });

  it("pads extra planned sets with the last known set values", () => {
    const history = [
      set({ exerciseId: "abductor", setIndex: 0, weightKg: 27, reps: 15, completedTs: 100 }),
      set({ exerciseId: "abductor", setIndex: 1, weightKg: 27, reps: 15, completedTs: 101 }),
    ];
    const prefill = prefillFromLastSession(history, "abductor", 4);
    expect(prefill).toHaveLength(4);
    expect(prefill[3]).toEqual({ weightKg: 27, reps: 15 });
  });

  it("carries seconds for timed exercises", () => {
    const history = [
      set({ exerciseId: "plank", setIndex: 0, seconds: 60, completedTs: 100 }),
    ];
    expect(prefillFromLastSession(history, "plank", 1)).toEqual([{ seconds: 60 }]);
  });

  it("returns empty targets when the exercise has never been done", () => {
    expect(prefillFromLastSession([], "newmove", 3)).toEqual([{}, {}, {}]);
  });

  it("ignores warmup sets", () => {
    const history = [
      set({ exerciseId: "squat", setIndex: 0, weightKg: 20, reps: 5, isWarmup: true, completedTs: 300 }),
      set({ exerciseId: "squat", setIndex: 0, weightKg: 32, reps: 10, completedTs: 100 }),
    ];
    expect(prefillFromLastSession(history, "squat", 1)).toEqual([{ weightKg: 32, reps: 10 }]);
  });
});
