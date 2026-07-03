import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "./db";
import { seedIfEmpty } from "./seed";

const USER1 = "user-1"; // fiveByFive template (program mode)
const USER2 = "user-2"; // routine template
import {
  nextProgramDay,
  buildSession,
  startWorkout,
  logSet,
  finishWorkout,
} from "./session";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedIfEmpty();
});

describe("nextProgramDay", () => {
  it("starts the program user on Workout A with no history", async () => {
    const day = await nextProgramDay(USER1);
    expect(day?.name).toBe("Workout A");
  });

  it("alternates to Workout B after an A workout", async () => {
    const day = await nextProgramDay(USER1);
    const w = await startWorkout(USER1, day!.id);
    await finishWorkout(w.workout.id);
    const next = await nextProgramDay(USER1);
    expect(next?.name).toBe("Workout B");
  });

  it("rotates the routine user through their three days", async () => {
    const d1 = await nextProgramDay(USER2);
    expect(d1?.name).toContain("Day 1");
    const w = await startWorkout(USER2, d1!.id);
    await finishWorkout(w.workout.id);
    const d2 = await nextProgramDay(USER2);
    expect(d2?.name).toContain("Day 2");
  });
});

describe("buildSession (program mode)", () => {
  it("prescribes working weights and warmups for Workout B", async () => {
    const days = await db.programDays.where({ programId: "program-5x5-user-1" }).toArray();
    const dayB = days.find((d) => d.name === "Workout B")!;
    const session = await buildSession(USER1, dayB.id);

    const squat = session.exercises.find((e) => e.exercise.name === "Squat")!;
    expect(squat.targets).toHaveLength(5);
    expect(squat.targets[0]).toMatchObject({ weightKg: 27.5, reps: 5 });
    expect(squat.warmups.length).toBeGreaterThan(0);

    const deadlift = session.exercises.find((e) => e.exercise.name === "Deadlift")!;
    expect(deadlift.targets).toHaveLength(1);
    expect(deadlift.targets[0]).toMatchObject({ weightKg: 120, reps: 5 });
    expect(deadlift.restSeconds).toBe(180);
  });
});

describe("buildSession (routine mode)", () => {
  it("prefills routine sets from the last session", async () => {
    // Log a prior Day 3 with 70kg smith thrusts
    const day3 = await db.programDays.get("day-routine-3-user-2");
    const first = await startWorkout(USER2, day3!.id);
    const smith = first.exercises.find((e) => e.exercise.name === "Smith hip thrust")!;
    for (let i = 0; i < 3; i++) {
      await logSet(first.workout.id, USER2, smith.exercise.id, i, {
        weightKg: 70,
        reps: 15,
      });
    }
    await finishWorkout(first.workout.id);

    const session = await buildSession(USER2, day3!.id);
    const smith2 = session.exercises.find((e) => e.exercise.name === "Smith hip thrust")!;
    expect(smith2.targets[0]).toMatchObject({ weightKg: 70, reps: 15 });

    const treadmill = session.exercises.find((e) => e.exercise.name === "Running (Treadmill)")!;
    expect(treadmill.targets[0]).toMatchObject({ seconds: 420 });
  });
});

describe("finishWorkout (program mode progression)", () => {
  it("advances squat +2.5kg after all reps hit", async () => {
    const dayB = await db.programDays.get("day-5x5-b-user-1");
    const s = await startWorkout(USER1, dayB!.id);
    const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
    for (let i = 0; i < 5; i++) {
      await logSet(s.workout.id, USER1, squat.exercise.id, i, {
        weightKg: 27.5,
        reps: 5,
      });
    }
    await finishWorkout(s.workout.id);

    const pes = await db.programExercises.where({ programDayId: dayB!.id }).toArray();
    const squatPe = pes.find((pe) => pe.exerciseId === squat.exercise.id)!;
    expect(squatPe.workingWeightKg).toBe(30);
  });

  it("holds the weight after a failed session", async () => {
    const dayB = await db.programDays.get("day-5x5-b-user-1");
    const s = await startWorkout(USER1, dayB!.id);
    const ohp = s.exercises.find((e) => e.exercise.name === "Overhead press")!;
    for (let i = 0; i < 5; i++) {
      await logSet(s.workout.id, USER1, ohp.exercise.id, i, {
        weightKg: 40,
        reps: i === 4 ? 3 : 5, // missed reps on the last set
      });
    }
    await finishWorkout(s.workout.id);

    const pes = await db.programExercises.where({ programDayId: dayB!.id }).toArray();
    const ohpPe = pes.find((pe) => pe.exerciseId === ohp.exercise.id)!;
    expect(ohpPe.workingWeightKg).toBe(40);
  });

  it("does not advance untouched exercises", async () => {
    const dayB = await db.programDays.get("day-5x5-b-user-1");
    const s = await startWorkout(USER1, dayB!.id);
    await finishWorkout(s.workout.id);
    const pes = await db.programExercises.where({ programDayId: dayB!.id }).toArray();
    expect(pes.every((pe) => pe.workingWeightKg !== undefined)).toBe(true);
    const deadlift = pes.find((pe) => pe.restSeconds === 180)!;
    expect(deadlift.workingWeightKg).toBe(120);
  });
});
