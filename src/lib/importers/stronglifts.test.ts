import { describe, it, expect } from "vitest";
import { parseStrongLiftsCsv } from "./stronglifts";

// Verbatim shape of the real Stronglifts20260702.csv export.
const CSV = `Date (yyyy/mm/dd),Workout,Workout Name,Program Name,Body Weight (KG),Exercise,SetsxReps,SetsxTime,Top Set Reps x KG,e1RM  (KG),Reps,Volume (KG),Workout Volume (KG),Duration (hours),Start Time (h:mm),End Time (h:mm),Notes,Set 1 (Reps), Set 1 (KG),Set 2 (Reps), Set 2 (KG),Set 3 (Reps), Set 3 (KG),Set 4 (Reps), Set 4 (KG),Set 5 (Reps), Set 5 (KG)
"2015/05/25","1","Workout A","","87","Squat","5x5","","5x20","24.7","25","500","1562.5","1","7:37 PM","8:37 PM","Second week, adding weight next week","5","20","5","20","5","20","5","20","5","20"
"2015/05/25","1","Workout A","","87","Bench Press","5x5","","5x20","24.7","25","500","1562.5","1","7:37 PM","8:37 PM","Second week, adding weight next week","5","20","5","20","5","20","5","20","5","20"
"2026/04/30","1269","Workout B","","97.75","Deadlift","1x5","","5x115","133.3","5","575","","0.6","7:00 AM","7:35 AM","","5","115","","","","","","","",""
"2026/04/30","1269","Workout B","","97.75","Chinups","3x10","","10x-5","","30","","","0.6","7:00 AM","7:35 AM","","10","-5","10","-5","10","-5","",""`;

describe("parseStrongLiftsCsv", () => {
  it("groups rows into workouts by workout number", () => {
    const result = parseStrongLiftsCsv(CSV);
    expect(result.workouts).toHaveLength(2);
    expect(result.workouts[0].dayLabel).toBe("Workout A");
    expect(result.workouts[0].date).toBe("2015-05-25");
    expect(result.workouts[1].dayLabel).toBe("Workout B");
  });

  it("expands Set N columns into individual sets", () => {
    const result = parseStrongLiftsCsv(CSV);
    const squatSets = result.workouts[0].exercises[0].sets;
    expect(squatSets).toHaveLength(5);
    expect(squatSets[0]).toEqual({ reps: 5, weightKg: 20 });
  });

  it("keeps single-set exercises (1x5 deadlift) to one set", () => {
    const result = parseStrongLiftsCsv(CSV);
    const deadlift = result.workouts[1].exercises.find((e) => e.name === "Deadlift")!;
    expect(deadlift.sets).toEqual([{ reps: 5, weightKg: 115 }]);
  });

  it("preserves negative (assisted) weights", () => {
    const result = parseStrongLiftsCsv(CSV);
    const chinups = result.workouts[1].exercises.find((e) => e.name === "Chinups")!;
    expect(chinups.sets).toHaveLength(3);
    expect(chinups.sets[0]).toEqual({ reps: 10, weightKg: -5 });
  });

  it("carries body weight and notes onto the workout", () => {
    const result = parseStrongLiftsCsv(CSV);
    expect(result.workouts[0].bodyWeightKg).toBe(87);
    expect(result.workouts[0].notes).toBe("Second week, adding weight next week");
    expect(result.workouts[1].bodyWeightKg).toBe(97.75);
    expect(result.workouts[1].notes).toBeUndefined();
  });

  it("dedupes the note repeated across exercise rows", () => {
    const result = parseStrongLiftsCsv(CSV);
    // both squat + bench rows carry the note; workout gets it once
    expect(result.workouts[0].notes).not.toContain("\n");
  });
});
