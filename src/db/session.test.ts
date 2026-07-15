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
  setWorkoutNote,
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
    const squat = w.exercises[0];
    await logSet(w.workout.id, USER1, squat.exercise.id, 0, { weightKg: 25, reps: 5 });
    await finishWorkout(w.workout.id);
    const next = await nextProgramDay(USER1);
    expect(next?.name).toBe("Workout B");
  });

  it("rotates the routine user through their three days", async () => {
    const d1 = await nextProgramDay(USER2);
    expect(d1?.name).toContain("Day 1");
    const w = await startWorkout(USER2, d1!.id);
    const first = w.exercises[0];
    await logSet(w.workout.id, USER2, first.exercise.id, 0, { reps: 15 });
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

  it("progresses assisted (negative) dips despite a stale bodyweight set", async () => {
    // Dips were bodyweight before assistance was set, so the first logged set
    // still carries a 0kg stamp while the rest are at −10kg. The session weight
    // must read as −10 (the worked weight), not 0 — otherwise the +2.5
    // increment lands on 2.5kg instead of −7.5kg.
    const dayA = (
      await db.programDays.where({ programId: "program-5x5-user-1" }).toArray()
    ).find((d) => d.name === "Workout A")!;
    const dipsPe = (
      await db.programExercises.where({ programDayId: dayA.id }).toArray()
    ).find((p) => p.exerciseId === "ex-user-1-dips")!;
    await db.programExercises.update(dipsPe.id, {
      workingWeightKg: -10,
      incrementKg: 2.5,
      sets: 3,
      targetReps: 10,
    });

    const s = await startWorkout(USER1, dayA.id);
    const dips = s.exercises.find((e) => e.exercise.id === "ex-user-1-dips")!;
    await logSet(s.workout.id, USER1, dips.exercise.id, 0, { weightKg: 0, reps: 10, targetReps: 10 });
    await logSet(s.workout.id, USER1, dips.exercise.id, 1, { weightKg: -10, reps: 10, targetReps: 10 });
    await logSet(s.workout.id, USER1, dips.exercise.id, 2, { weightKg: -10, reps: 10, targetReps: 10 });
    await finishWorkout(s.workout.id);

    const after = await db.programExercises.get(dipsPe.id);
    expect(after?.workingWeightKg).toBe(-7.5);
  });

  it("does not advance untouched exercises", async () => {
    const dayB = await db.programDays.get("day-5x5-b-user-1");
    const s = await startWorkout(USER1, dayB!.id);
    const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
    await logSet(s.workout.id, USER1, squat.exercise.id, 0, { weightKg: 27.5, reps: 5 });
    await finishWorkout(s.workout.id);
    const pes = await db.programExercises.where({ programDayId: dayB!.id }).toArray();
    expect(pes.every((pe) => pe.workingWeightKg !== undefined)).toBe(true);
    const deadlift = pes.find((pe) => pe.restSeconds === 180)!;
    expect(deadlift.workingWeightKg).toBe(120);
  });
});

describe("setWorkoutNote", () => {
  it("saves a trimmed note onto the workout", async () => {
    const day = await nextProgramDay(USER1);
    const s = await startWorkout(USER1, day!.id);
    await setWorkoutNote(s.workout.id, "  felt strong, bar speed good  ");
    const w = await db.workouts.get(s.workout.id);
    expect(w?.notes).toBe("felt strong, bar speed good");
  });

  it("clears the note when blank", async () => {
    const day = await nextProgramDay(USER1);
    const s = await startWorkout(USER1, day!.id);
    await setWorkoutNote(s.workout.id, "temp");
    await setWorkoutNote(s.workout.id, "   ");
    const w = await db.workouts.get(s.workout.id);
    expect(w?.notes).toBe("");
  });
});

describe("Madcow (ramped sets + weekly shared-top progression)", () => {
  async function seedMadcow() {
    await db.exercises.add({ id: "mc-squat", userId: USER1, name: "MC Squat", kind: "weighted", restSeconds: 300 });
    await db.programs.add({ id: "mc-prog", userId: USER1, name: "Madcow", mode: "madcow", templateId: "madcow" });
    await db.programDays.bulkAdd([
      { id: "mc-mon", programId: "mc-prog", position: 0, name: "Monday" },
      { id: "mc-fri", programId: "mc-prog", position: 1, name: "Friday" },
    ]);
    await db.programExercises.bulkAdd([
      { id: "mc-pe-mon", programDayId: "mc-mon", exerciseId: "mc-squat", position: 0, sets: 5, targetReps: 5, incrementKg: 2.5, workingWeightKg: 100, madcowRole: "heavy", madcowProgresses: false },
      { id: "mc-pe-fri", programDayId: "mc-fri", exerciseId: "mc-squat", position: 0, sets: 6, targetReps: 5, incrementKg: 2.5, workingWeightKg: 100, madcowRole: "intensity", madcowProgresses: true },
    ]);
  }

  it("builds a ramped target list for the day's role", async () => {
    await seedMadcow();
    const s = await buildSession(USER1, "mc-fri");
    const squat = s.exercises.find((e) => e.exercise.id === "mc-squat")!;
    expect(squat.targets.map((t) => [t.weightKg, t.reps])).toEqual([
      [50, 5], [62.5, 5], [75, 5], [87.5, 5], [102.5, 3], [75, 8],
    ]);
    expect(squat.warmups).toHaveLength(0);
  });

  it("advances the shared top on both day-rows when the Friday PR is hit", async () => {
    await seedMadcow();
    const s = await startWorkout(USER1, "mc-fri");
    await logSet(s.workout.id, USER1, "mc-squat", 4, { weightKg: 102.5, reps: 3 }); // top set hit
    await finishWorkout(s.workout.id);
    const mon = await db.programExercises.get("mc-pe-mon");
    const fri = await db.programExercises.get("mc-pe-fri");
    expect(mon?.workingWeightKg).toBe(102.5);
    expect(fri?.workingWeightKg).toBe(102.5);
  });

  it("holds the top when the PR set is missed", async () => {
    await seedMadcow();
    const s = await startWorkout(USER1, "mc-fri");
    await logSet(s.workout.id, USER1, "mc-squat", 4, { weightKg: 102.5, reps: 2 }); // missed
    await finishWorkout(s.workout.id);
    const fri = await db.programExercises.get("mc-pe-fri");
    expect(fri?.workingWeightKg).toBe(100);
  });
});

/** One open workout per day, per day. The workout screen already assumes this
 * ("an in-progress workout ALWAYS wins"), but it enforced it only in the page
 * — so any remount that re-ran the effect minted a second row. Those phantoms
 * are invisible (unfinished workouts don't show in History) and permanent. */
describe("startWorkout (no phantom rows)", () => {
  it("reuses today's open workout instead of starting a second one", async () => {
    const first = await startWorkout(USER1, "day-5x5-a-user-1");
    const second = await startWorkout(USER1, "day-5x5-a-user-1");

    expect(second.workout.id).toBe(first.workout.id);
    expect(await db.workouts.where({ userId: USER1 }).count()).toBe(1);
  });

  it("starts a fresh workout once the previous one is finished", async () => {
    const first = await startWorkout(USER1, "day-5x5-a-user-1");
    const squat = first.exercises.find((e) => e.exercise.name === "Squat")!;
    await logSet(first.workout.id, USER1, squat.exercise.id, 0, { weightKg: 25, reps: 5 });
    await finishWorkout(first.workout.id);

    const second = await startWorkout(USER1, "day-5x5-a-user-1");
    expect(second.workout.id).not.toBe(first.workout.id);
  });

  it("does not adopt an abandoned workout from an earlier date", async () => {
    const stale = await startWorkout(USER1, "day-5x5-a-user-1");
    await db.workouts.update(stale.workout.id, { date: "2020-01-01" });

    const today = await startWorkout(USER1, "day-5x5-a-user-1");
    expect(today.workout.id).not.toBe(stale.workout.id);
  });
});
