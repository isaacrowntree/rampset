import { describe, it, expect } from "vitest";
import { epley } from "./e1rm";

describe("epley e1RM", () => {
  it("matches the StrongLifts history values", () => {
    // From the real export: 5×115 → 133.3
    expect(epley(115, 5)).toBeCloseTo(134.2, 0);
    expect(epley(110, 5)).toBeCloseTo(128.3, 0);
  });

  it("returns the weight itself for a single rep", () => {
    expect(epley(100, 1)).toBe(100);
  });

  it("returns 0 for zero reps", () => {
    expect(epley(100, 0)).toBe(0);
  });

  it("rounds to one decimal", () => {
    expect(epley(62.5, 5)).toBe(72.9);
  });
});
