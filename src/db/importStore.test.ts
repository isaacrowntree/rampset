import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "./db";
import { seedIfEmpty } from "./seed";

const USER1 = "user-1"; // fiveByFive template (program mode)
const USER2 = "user-2"; // routine template
import { importIntoStore } from "./importStore";
import { parseStrongCsv } from "@/lib/importers/strong";
import { parseStrongLiftsCsv } from "@/lib/importers/stronglifts";

const STRONG_CSV = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2026-03-05 07:10:00,"Day 3 Quad Glute Combo",50m,"Smith hip Thrust ",1,70.0,15.0,0,0.0,"","",
2026-03-05 07:10:00,"Day 3 Quad Glute Combo",50m,"Smith hip Thrust ",Rest Timer,0,0.0,0,120.0,,,
2026-03-05 07:10:00,"Day 3 Quad Glute Combo",50m,"Smith hip Thrust ",2,70.0,15.0,0,0.0,"","",`;

const SL_CSV = `Date (yyyy/mm/dd),Workout,Workout Name,Program Name,Body Weight (KG),Exercise,SetsxReps,SetsxTime,Top Set Reps x KG,e1RM  (KG),Reps,Volume (KG),Workout Volume (KG),Duration (hours),Start Time (h:mm),End Time (h:mm),Notes,Set 1 (Reps), Set 1 (KG),Set 2 (Reps), Set 2 (KG),Set 3 (Reps), Set 3 (KG),Set 4 (Reps), Set 4 (KG),Set 5 (Reps), Set 5 (KG)
"2026/04/30","1269","Workout B","","97.75","Deadlift","1x5","","5x115","133.3","5","575","","0.6","7:00 AM","7:35 AM","","5","115","","","","","","","",""`;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedIfEmpty();
});

describe("importIntoStore", () => {
  it("writes Strong workouts against existing seeded exercises (no dupes)", async () => {
    const before = await db.exercises.where({ userId: USER2 }).count();
    await importIntoStore(USER2, parseStrongCsv(STRONG_CSV));
    const after = await db.exercises.where({ userId: USER2 }).count();
    expect(after).toBe(before); // "Smith hip Thrust " matches seeded "Smith hip thrust"

    const workouts = await db.workouts.where({ userId: USER2 }).toArray();
    expect(workouts).toHaveLength(1);
    expect(workouts[0].dayLabel).toBe("Day 3 Quad Glute Combo");
    expect(workouts[0].endTs).toBeDefined();

    const sets = await db.sets.where({ userId: USER2 }).toArray();
    expect(sets).toHaveLength(2);
    expect(sets[0].weightKg).toBe(70);
  });

  it("creates unknown exercises on the fly", async () => {
    const csv = STRONG_CSV.replaceAll("Smith hip Thrust ", "Cable kickbacks");
    await importIntoStore(USER2, parseStrongCsv(csv));
    const created = await db.exercises
      .where({ userId: USER2 })
      .and((e) => e.name === "Cable kickbacks")
      .first();
    expect(created).toBeDefined();
    expect(created!.restSeconds).toBe(120); // mined from rest-timer rows
  });

  it("imports StrongLifts workouts with sets and body weight", async () => {
    await importIntoStore(USER1, parseStrongLiftsCsv(SL_CSV));
    const workouts = await db.workouts.where({ userId: USER1 }).toArray();
    expect(workouts).toHaveLength(1);
    expect(workouts[0].bodyWeightKg).toBe(97.75);
    const sets = await db.sets.where({ userId: USER1 }).toArray();
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ weightKg: 115, reps: 5 });
  });

  it("is idempotent per (date, dayLabel) — re-import doesn't duplicate", async () => {
    await importIntoStore(USER1, parseStrongLiftsCsv(SL_CSV));
    await importIntoStore(USER1, parseStrongLiftsCsv(SL_CSV));
    const workouts = await db.workouts.where({ userId: USER1 }).toArray();
    expect(workouts).toHaveLength(1);
  });
});
