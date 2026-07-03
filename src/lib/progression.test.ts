import { describe, it, expect } from "vitest";
import { nextWorkingWeight, roundToIncrement, type SessionResult } from "./progression";

const squat = {
  incrementKg: 2.5,
  deloadPct: 0.1,
  deloadAfterFails: 3,
};

function session(weightKg: number, allRepsHit: boolean): SessionResult {
  return { weightKg, success: allRepsHit };
}

describe("nextWorkingWeight (program mode)", () => {
  it("adds the increment after a successful session", () => {
    expect(nextWorkingWeight(squat, [session(60, true)])).toBe(62.5);
  });

  it("holds the weight after one failed session", () => {
    expect(nextWorkingWeight(squat, [session(60, false)])).toBe(60);
  });

  it("holds the weight after two consecutive fails", () => {
    expect(
      nextWorkingWeight(squat, [session(60, false), session(60, false)]),
    ).toBe(60);
  });

  it("deloads 10% after three consecutive fails at the same weight", () => {
    expect(
      nextWorkingWeight(squat, [
        session(60, false),
        session(60, false),
        session(60, false),
      ]),
    ).toBe(52.5); // 54 rounded down to plate-loadable 2.5 step
  });

  it("a success between fails resets the fail count", () => {
    expect(
      nextWorkingWeight(squat, [
        session(60, false),
        session(60, true), // resets
        session(62.5, false),
        session(62.5, false),
      ]),
    ).toBe(62.5);
  });

  it("only counts fails at the current weight", () => {
    expect(
      nextWorkingWeight(squat, [
        session(57.5, false),
        session(60, false),
        session(60, false),
      ]),
    ).toBe(60);
  });

  it("uses per-exercise increments (deadlift +5kg)", () => {
    const deadlift = { ...squat, incrementKg: 5 };
    expect(nextWorkingWeight(deadlift, [session(120, true)])).toBe(125);
  });

  it("starts from the last session weight with an empty history edge", () => {
    expect(nextWorkingWeight(squat, [])).toBeUndefined();
  });
});

describe("roundToIncrement", () => {
  it("rounds down to the nearest 2.5", () => {
    expect(roundToIncrement(54, 2.5)).toBe(52.5);
    expect(roundToIncrement(55, 2.5)).toBe(55);
    expect(roundToIncrement(108, 2.5)).toBe(107.5);
  });
});
