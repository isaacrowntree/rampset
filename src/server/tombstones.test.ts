import { describe, it, expect } from "vitest";
import { tombstonedWorkoutIds } from "./tombstones";

const op = (seq: number, payload: unknown) => ({ seq, opId: `del:${seq}`, kind: "deleteWorkout", payload });

describe("tombstonedWorkoutIds", () => {
  it("lists each deleted workout once", () => {
    expect(tombstonedWorkoutIds([op(1, { workoutId: "w1" }), op(2, { workoutId: "w2" }), op(3, { workoutId: "w1" })])).toEqual([
      "w1",
      "w2",
    ]);
  });

  it("ignores payloads that don't name a workout", () => {
    expect(tombstonedWorkoutIds([op(1, null), op(2, { workoutId: "" }), op(3, { workoutId: 4 })])).toEqual([]);
  });
});
