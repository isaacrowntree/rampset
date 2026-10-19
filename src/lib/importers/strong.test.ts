import { describe, it, expect } from "vitest";
import { parseStrongCsv, normalizeExerciseName } from "./strong";

// Verbatim shape of a real Strong app export.
const CSV = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-03-05 07:10:00,"Day 3 Quad Glute Combo",62h 43m,"Running (Treadmill)",1,0,0.0,0,420.0,"","",
2026-03-05 07:10:00,"Day 3 Quad Glute Combo",62h 43m,"Running (Treadmill)",Rest Timer,0,0.0,0,120.0,,,
2026-03-05 07:10:00,"Day 3 Quad Glute Combo",62h 43m,"Smith hip Thrust ",1,70.0,15.0,0,0.0,"","",
2026-03-05 07:10:00,"Day 3 Quad Glute Combo",62h 43m,"Smith hip Thrust ",Rest Timer,0,0.0,0,120.0,,,
2026-03-05 07:10:00,"Day 3 Quad Glute Combo",62h 43m,"Smith hip Thrust ",2,70.0,15.0,0,0.0,"","",
2026-03-05 07:10:00,"Day 3 Quad Glute Combo",62h 43m,"Dead bug",1,0,10.0,0,0.0,"","",
2026-03-05 07:10:00,"Day 3 Quad Glute Combo",62h 43m,"Walking lunges",1,0,10.0,0,0.0,"Check if it’s 10 per leg or 10 for all","",
2026-05-14 06:42:46,"Day 2 Glute Medius",38m,"Single lef hip thrust ",1,0.0,15.0,0,0.0,"","",
2026-05-14 06:42:46,"Day 2 Glute Medius",38m,"Single lef hip thrust ",Rest Timer,0,0.0,0,60.0,,,`;

describe("parseStrongCsv", () => {
  it("groups by workout start timestamp", () => {
    const result = parseStrongCsv(CSV);
    expect(result.workouts).toHaveLength(2);
    expect(result.workouts[0].date).toBe("2026-03-05");
    expect(result.workouts[0].dayLabel).toBe("Day 3 Quad Glute Combo");
    expect(result.workouts[1].dayLabel).toBe("Day 2 Glute Medius");
  });

  it("skips Rest Timer rows as sets but mines them for rest defaults", () => {
    const result = parseStrongCsv(CSV);
    const smith = result.workouts[0].exercises.find((e) => e.name === "Smith hip thrust")!;
    expect(smith.sets).toHaveLength(2);
    expect(smith.restSeconds).toBe(120);
  });

  it("classifies timed sets from the Seconds column", () => {
    const result = parseStrongCsv(CSV);
    const treadmill = result.workouts[0].exercises.find((e) => e.name === "Running (Treadmill)")!;
    expect(treadmill.kind).toBe("timed");
    expect(treadmill.sets[0]).toEqual({ seconds: 420 });
  });

  it("classifies bodyweight sets when weight is 0 with reps", () => {
    const result = parseStrongCsv(CSV);
    const deadbug = result.workouts[0].exercises.find((e) => e.name === "Dead bug")!;
    expect(deadbug.kind).toBe("bodyweight");
    expect(deadbug.sets[0]).toEqual({ reps: 10 });
  });

  it("classifies weighted sets and keeps weight + reps", () => {
    const result = parseStrongCsv(CSV);
    const smith = result.workouts[0].exercises.find((e) => e.name === "Smith hip thrust")!;
    expect(smith.kind).toBe("weighted");
    expect(smith.sets[0]).toEqual({ weightKg: 70, reps: 15 });
  });

  it("keeps set notes", () => {
    const result = parseStrongCsv(CSV);
    const lunges = result.workouts[0].exercises.find((e) => e.name === "Walking lunges")!;
    expect(lunges.sets[0].note).toBe("Check if it’s 10 per leg or 10 for all");
  });

  it("normalizes exercise names (trim + collapse whitespace)", () => {
    const result = parseStrongCsv(CSV);
    const names = result.workouts.flatMap((w) => w.exercises.map((e) => e.name));
    expect(names).toContain("Smith hip thrust");
    expect(names).toContain("Single lef hip thrust");
    expect(names.some((n) => n.endsWith(" "))).toBe(false);
  });
});

describe("normalizeExerciseName", () => {
  it("trims and collapses inner whitespace, lowercases all but first word", () => {
    expect(normalizeExerciseName("Smith hip Thrust ")).toBe("Smith hip thrust");
    expect(normalizeExerciseName("  Globet  squat ")).toBe("Globet squat");
  });

  it("preserves parenthetical equipment qualifiers", () => {
    expect(normalizeExerciseName("Hip Abductor (Machine)")).toBe("Hip abductor (Machine)");
  });
});
