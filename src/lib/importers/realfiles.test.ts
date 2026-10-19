import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { parseStrongLiftsCsv } from "./stronglifts";
import { parseStrongCsv } from "./strong";

// Optional acceptance tests against real exports. Point these env vars at
// your own export files to run them; they skip when unset:
//   LIFTLOG_SL_EXPORT=~/stronglifts.csv LIFTLOG_STRONG_EXPORT=~/strong.csv npm test
const SL_PATH = process.env.LIFTLOG_SL_EXPORT ?? "";
const STRONG_PATH = process.env.LIFTLOG_STRONG_EXPORT ?? "";

describe.skipIf(!SL_PATH || !existsSync(SL_PATH))("real StrongLifts export", () => {
  it("imports every workout and keeps all sets", () => {
    const result = parseStrongLiftsCsv(readFileSync(SL_PATH, "utf8"));
    expect(result.workouts.length).toBeGreaterThan(0);
    const sets = result.workouts.flatMap((w) => w.exercises.flatMap((e) => e.sets));
    expect(sets.length).toBeGreaterThan(result.workouts.length);
  });
});

describe.skipIf(!STRONG_PATH || !existsSync(STRONG_PATH))("real Strong export", () => {
  it("imports every workout with normalized exercise names", () => {
    const result = parseStrongCsv(readFileSync(STRONG_PATH, "utf8"));
    expect(result.workouts.length).toBeGreaterThan(0);
    const names = new Set(
      result.workouts.flatMap((w) => w.exercises.map((e) => e.name)),
    );
    expect([...names].every((n) => n === n.replace(/\s+/g, " ").trim())).toBe(true);
  });
});
