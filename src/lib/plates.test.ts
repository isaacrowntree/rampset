import { describe, it, expect } from "vitest";
import { platesPerSide, warmupRamp, loadColor, DEFAULT_PLATES, PLATES_WITHOUT_25 } from "./plates";

describe("platesPerSide", () => {
  it("loads 120kg as 25+25 per side — 25s are in by default", () => {
    expect(platesPerSide(120, 20, DEFAULT_PLATES)).toEqual([25, 25]);
  });

  it("loads 120kg as 20+20+10 per side in a gym without 25s", () => {
    expect(platesPerSide(120, 20, PLATES_WITHOUT_25)).toEqual([20, 20, 10]);
  });

  it("loads 27.5kg as 2.5+1.25 per side", () => {
    expect(platesPerSide(27.5, 20, DEFAULT_PLATES)).toEqual([2.5, 1.25]);
  });

  it("returns empty for an empty bar", () => {
    expect(platesPerSide(20, 20, DEFAULT_PLATES)).toEqual([]);
  });

  it("prefers big plates greedily", () => {
    expect(platesPerSide(100, 20, DEFAULT_PLATES)).toEqual([25, 15]);
    expect(platesPerSide(100, 20, PLATES_WITHOUT_25)).toEqual([20, 20]);
  });

  it("returns null when the weight is not loadable with available plates", () => {
    expect(platesPerSide(21, 20, DEFAULT_PLATES)).toBeNull();
  });
});

describe("warmupRamp (SL protocol)", () => {
  it("generates the SL ramp for a 40kg overhead press (bar lift)", () => {
    expect(warmupRamp(40, 20, "bar")).toEqual([
      { reps: 5, weightKg: 20 },
      { reps: 5, weightKg: 20 },
      { reps: 3, weightKg: 30 },
    ]);
  });

  it("always starts bar lifts with two empty-bar sets, even on long spans", () => {
    const ramp = warmupRamp(62.5, 20, "bar");
    expect(ramp[0]).toEqual({ reps: 5, weightKg: 20 });
    expect(ramp[1]).toEqual({ reps: 5, weightKg: 20 });
    expect(ramp.length).toBeGreaterThan(3);
    expect(ramp.every((w) => w.weightKg < 62.5)).toBe(true);
  });

  it("generates the SL ramp for a 120kg deadlift (floor pull, no empty bar)", () => {
    expect(warmupRamp(120, 20, "floor")).toEqual([
      { reps: 5, weightKg: 60 },
      { reps: 5, weightKg: 80 },
      { reps: 3, weightKg: 100 },
      { reps: 2, weightKg: 110 },
    ]);
  });

  it("floor pulls never include empty-bar sets", () => {
    const ramp = warmupRamp(80, 20, "floor");
    expect(ramp.every((w) => w.weightKg >= 40)).toBe(true);
  });

  it("doesn't bother warming up light floor pulls (weight can't ramp)", () => {
    expect(warmupRamp(30, 20, "floor")).toEqual([]);
    expect(warmupRamp(40, 20, "floor")).toEqual([]);
  });

  it("lands warmups on 10kg totals — whole plates, no change", () => {
    expect(warmupRamp(62.5, 20, "bar").map((w) => w.weightKg)).toEqual([
      20, 20, 30, 40, 50, 60,
    ]);
    expect(warmupRamp(132.5, 20, "floor").map((w) => w.weightKg)).toEqual([
      70, 90, 110, 120,
    ]);
  });

  it("never needs 1.25s, and climbs strictly below the work weight", () => {
    for (let work = 27.5; work <= 200; work += 2.5) {
      for (const style of ["bar", "floor"] as const) {
        const ramp = warmupRamp(work, 20, style).filter((w) => w.weightKg > 20);
        for (const [i, w] of ramp.entries()) {
          expect(w.weightKg % 5).toBe(0);
          expect(w.weightKg).toBeLessThan(work);
          if (i > 0) expect(w.weightKg).toBeGreaterThan(ramp[i - 1].weightKg);
        }
      }
    }
  });

  it("returns no warmups at or below bar weight", () => {
    expect(warmupRamp(20, 20, "bar")).toEqual([]);
    expect(warmupRamp(25, 20, "bar")).toEqual([]);
  });
});

describe("loadColor (the plate a set wears)", () => {
  it("is the heaviest plate on the bar", () => {
    expect(loadColor(120)?.fill).toBe("var(--plate-25)"); // 25+25 a side
    expect(loadColor(120, 20, PLATES_WITHOUT_25)?.fill).toBe("var(--plate-20)"); // 20+20+10
    expect(loadColor(50)?.fill).toBe("var(--plate-15)"); // 15 a side
    expect(loadColor(40)?.fill).toBe("var(--plate-10)"); // 10 a side
  });

  it("reads as bare steel with only change plates on", () => {
    expect(loadColor(20)).toEqual(loadColor(27.5)); // a 2.5 is not a 25
  });

  it("is null off the bar (bodyweight, dumbbells, assistance)", () => {
    expect(loadColor(undefined)).toBeNull();
    expect(loadColor(12.5)).toBeNull();
    expect(loadColor(-10)).toBeNull();
  });
});
