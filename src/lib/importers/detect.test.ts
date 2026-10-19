import { describe, it, expect } from "vitest";
import { parseExport } from "./detect";

const STRONG = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-03-05 07:10:00,"Day 3",50m,"Squat",1,70.0,5.0,0,0.0,"","",`;

const STRONGLIFTS = `Date (yyyy/mm/dd),Workout,Workout Name,Program Name,Body Weight (KG),Exercise,SetsxReps,SetsxTime,Top Set Reps x KG,e1RM  (KG),Reps,Volume (KG),Workout Volume (KG),Duration (hours),Start Time (h:mm),End Time (h:mm),Notes,Set 1 (Reps), Set 1 (KG)
"2026/04/30","1269","Workout B","","97.75","Deadlift","1x5","","5x115","133.3","5","575","","0.6","7:00 AM","7:35 AM","","5","115"`;

describe("parseExport", () => {
  it("recognises a Strong export", () => {
    expect(parseExport(STRONG)?.source).toBe("Strong");
  });

  it("recognises a StrongLifts export", () => {
    expect(parseExport(STRONGLIFTS)?.source).toBe("StrongLifts");
  });

  it("refuses anything else rather than guessing", () => {
    expect(parseExport("name,weight\nSquat,100")).toBeNull();
  });

  it("refuses an export with no workouts in it", () => {
    expect(parseExport(STRONG.split("\n")[0])).toBeNull();
  });
});
