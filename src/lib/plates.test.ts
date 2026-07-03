import { describe, it, expect } from "vitest";
import { platesPerSide, warmupRamp, DEFAULT_PLATES } from "./plates";

describe("platesPerSide", () => {
  it("loads 120kg as 20+20+10 per side on a 20kg bar", () => {
    expect(platesPerSide(120, 20, DEFAULT_PLATES)).toEqual([20, 20, 10]);
  });

  it("loads 27.5kg as 2.5+1.25 per side", () => {
    expect(platesPerSide(27.5, 20, DEFAULT_PLATES)).toEqual([2.5, 1.25]);
  });

  it("returns empty for an empty bar", () => {
    expect(platesPerSide(20, 20, DEFAULT_PLATES)).toEqual([]);
  });

  it("prefers big plates greedily", () => {
    expect(platesPerSide(100, 20, DEFAULT_PLATES)).toEqual([20, 20]);
  });

  it("returns null when the weight is not loadable with available plates", () => {
    expect(platesPerSide(21, 20, DEFAULT_PLATES)).toBeNull();
  });
});

describe("warmupRamp", () => {
  it("generates SL-style ramp for a 40kg overhead press", () => {
    expect(warmupRamp(40, 20)).toEqual([
      { reps: 5, weightKg: 20 },
      { reps: 5, weightKg: 20 },
      { reps: 3, weightKg: 30 },
    ]);
  });

  it("generates a longer ramp for a 120kg deadlift", () => {
    expect(warmupRamp(120, 20)).toEqual([
      { reps: 5, weightKg: 60 },
      { reps: 5, weightKg: 80 },
      { reps: 3, weightKg: 100 },
      { reps: 2, weightKg: 110 },
    ]);
  });

  it("returns no warmups at or below bar weight", () => {
    expect(warmupRamp(20, 20)).toEqual([]);
    expect(warmupRamp(25, 20)).toEqual([]);
  });
});
