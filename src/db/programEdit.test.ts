import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "./db";
import { seedIfEmpty } from "@/test/seed";
import { addDay, deleteDay, moveExercise, renameDay } from "./programEdit";

const PROGRAM = "program-routine-user-2";
const DAY1 = "day-routine-1-user-2";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedIfEmpty();
});

const dayNames = async () =>
  (await db.programDays.where({ programId: PROGRAM }).sortBy("position")).map((d) => d.name);
const exerciseOrder = async (dayId: string) =>
  (await db.programExercises.where({ programDayId: dayId }).sortBy("position")).map((pe) => pe.exerciseId);

describe("routine days", () => {
  it("are added at the end, named or numbered", async () => {
    await addDay(PROGRAM, "Upper");
    await addDay(PROGRAM, "  ");
    const names = await dayNames();
    expect(names.slice(-2)).toEqual(["Upper", "Day 5"]);
  });

  it("are renamed, ignoring a blank name", async () => {
    await renameDay(DAY1, "Legs");
    await renameDay(DAY1, " ");
    expect((await dayNames())[0]).toBe("Legs");
  });

  // A workout keeps its dayLabel, so history reads the same after the day is
  // gone; exercises keep their history and may be on other days.
  it("are deleted with their slots, never with history or exercises", async () => {
    await db.workouts.add({ id: "w1", userId: "user-2", dayLabel: "Day 1", date: "2026-01-01", programDayId: DAY1 });
    const exercisesBefore = await db.exercises.where({ userId: "user-2" }).count();
    await deleteDay(DAY1);
    expect(await db.programDays.get(DAY1)).toBeUndefined();
    expect(await db.programExercises.where({ programDayId: DAY1 }).count()).toBe(0);
    expect(await db.workouts.get("w1")).toMatchObject({ dayLabel: "Day 1" });
    expect(await db.exercises.where({ userId: "user-2" }).count()).toBe(exercisesBefore);
  });
});

describe("moveExercise", () => {
  it("swaps an exercise with its neighbour", async () => {
    const [first, second, ...rest] = await exerciseOrder(DAY1);
    const pe = (await db.programExercises.where({ programDayId: DAY1 }).sortBy("position"))[1];
    await moveExercise(pe.id, -1);
    expect(await exerciseOrder(DAY1)).toEqual([second, first, ...rest]);
  });

  it("does nothing past either end", async () => {
    const before = await exerciseOrder(DAY1);
    const rows = await db.programExercises.where({ programDayId: DAY1 }).sortBy("position");
    await moveExercise(rows[0].id, -1);
    await moveExercise(rows[rows.length - 1].id, 1);
    expect(await exerciseOrder(DAY1)).toEqual(before);
  });
});
