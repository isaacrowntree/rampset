/** Regression specs for the confirmed review findings (data layer). */

import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "./db";
import { seedIfEmpty } from "./seed";
import {
  startWorkout,
  logSet,
  clearSet,
  finishWorkout,
  buildSession,
  loadLoggedSets,
  nextProgramDay,
} from "./session";
import { importIntoStore } from "./importStore";
import { exportBackup, restoreBackup } from "./backup";
import { parseStrongLiftsCsv } from "@/lib/importers/stronglifts";

const USER1 = "user-1";
const USER2 = "user-2";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedIfEmpty();
});

/* Finding: loose idempotency key silently drops same-day same-label workouts */
describe("import dedup (two sessions, same day, same label)", () => {
  const TWO_SAME_DAY = `Date (yyyy/mm/dd),Workout,Workout Name,Program Name,Body Weight (KG),Exercise,SetsxReps,SetsxTime,Top Set Reps x KG,e1RM  (KG),Reps,Volume (KG),Workout Volume (KG),Duration (hours),Start Time (h:mm),End Time (h:mm),Notes,Set 1 (Reps), Set 1 (KG),Set 2 (Reps), Set 2 (KG),Set 3 (Reps), Set 3 (KG),Set 4 (Reps), Set 4 (KG),Set 5 (Reps), Set 5 (KG)
"2015/05/25","1","Workout A","","87","Squat","5x5","","5x20","24.7","25","500","","1","7:37 PM","8:37 PM","","5","20","5","20","5","20","5","20","5","20"
"2015/05/25","2","Workout A","","87","Squat","5x5","","5x20","24.7","25","500","","1","9:37 PM","10:37 PM","","5","20","5","20","5","20","5","20","5","20"`;

  it("imports both distinct same-day workouts", async () => {
    const summary = await importIntoStore(USER1, parseStrongLiftsCsv(TWO_SAME_DAY));
    expect(summary.workoutsAdded).toBe(2);
    const workouts = await db.workouts.where({ userId: USER1 }).toArray();
    expect(workouts).toHaveLength(2);
  });

  it("stays idempotent on re-import", async () => {
    await importIntoStore(USER1, parseStrongLiftsCsv(TWO_SAME_DAY));
    const second = await importIntoStore(USER1, parseStrongLiftsCsv(TWO_SAME_DAY));
    expect(second.workoutsAdded).toBe(0);
    expect(second.workoutsSkipped).toBe(2);
    const workouts = await db.workouts.where({ userId: USER1 }).toArray();
    expect(workouts).toHaveLength(2);
  });

  it("orders same-day workouts by their sequence in the export", async () => {
    await importIntoStore(USER1, parseStrongLiftsCsv(TWO_SAME_DAY));
    const workouts = await db.workouts.where({ userId: USER1 }).sortBy("startTs");
    expect(workouts[0].startTs!).toBeLessThan(workouts[1].startTs!);
  });
});

/* Finding: extra sets beyond pe.sets void an otherwise successful session */
describe("progression success with extra back-off sets", () => {
  it("still advances when all prescribed sets hit target plus a partial extra", async () => {
    const dayB = await db.programDays.get("day-5x5-b-user-1");
    const s = await startWorkout(USER1, dayB!.id);
    const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
    for (let i = 0; i < 5; i++) {
      await logSet(s.workout.id, USER1, squat.exercise.id, i, { weightKg: 27.5, reps: 5 });
    }
    // extra 6th set, only 3 reps — a back-off, not a failure
    await logSet(s.workout.id, USER1, squat.exercise.id, 5, { weightKg: 27.5, reps: 3 });
    await finishWorkout(s.workout.id);

    const pes = await db.programExercises.where({ programDayId: dayB!.id }).toArray();
    const squatPe = pes.find((pe) => pe.exerciseId === squat.exercise.id)!;
    expect(squatPe.workingWeightKg).toBe(30);
  });
});

/* Finding: fail streaks never accumulate for exercises trained on multiple days */
/** Only meaningful for a program that opts OUT of linking: two slots of the
 * same lift climbing independent ladders. With linking on (the StrongLifts
 * default) A and B are one ladder at one weight, so an interleaved success
 * legitimately resets the fail streak — see "deloads a linked lift" below. */
describe("deload counting is scoped to the program day (unlinked programs)", () => {
  it("deloads day-B squat after three same-weight fails despite interleaved day-A squats", async () => {
    await db.programs.update("program-5x5-user-1", { linkedProgression: false });
    const dayA = await db.programDays.get("day-5x5-a-user-1");
    const dayB = await db.programDays.get("day-5x5-b-user-1");

    for (let round = 0; round < 3; round++) {
      // Day B squat fails at 27.5
      const b = await startWorkout(USER1, dayB!.id);
      const squatB = b.exercises.find((e) => e.exercise.name === "Squat")!;
      for (let i = 0; i < 5; i++) {
        await logSet(b.workout.id, USER1, squatB.exercise.id, i, { weightKg: 27.5, reps: 3 });
      }
      await finishWorkout(b.workout.id);

      // Interleaved day A squat succeeds at its own weight
      const a = await startWorkout(USER1, dayA!.id);
      const squatA = a.exercises.find((e) => e.exercise.name === "Squat")!;
      const weightA = squatA.targets[0]!.weightKg!;
      for (let i = 0; i < 5; i++) {
        await logSet(a.workout.id, USER1, squatA.exercise.id, i, { weightKg: weightA, reps: 5 });
      }
      await finishWorkout(a.workout.id);
    }

    const pes = await db.programExercises.where({ programDayId: dayB!.id }).toArray();
    const squatPe = pes.find((pe) => pe.restSeconds === undefined && pe.sets === 5 && pe.position === 0)!;
    // three fails at 27.5 → deload 10% → floor to 2.5 step = 24.72 → wait: 27.5*0.9=24.75 → 22.5? floor(24.75/2.5)=9 → 22.5... 9*2.5=22.5
    expect(squatPe.workingWeightKg).toBe(22.5);
  });

  it("deloads a linked lift after three consecutive fails ACROSS days", async () => {
    // Squat is one ladder, so its fail streak spans A and B.
    for (const dayId of ["day-5x5-b-user-1", "day-5x5-a-user-1", "day-5x5-b-user-1"]) {
      const s = await startWorkout(USER1, dayId);
      const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
      const at = squat.targets[0]!.weightKg!;
      for (let i = 0; i < squat.programExercise.sets; i++) {
        await logSet(s.workout.id, USER1, squat.exercise.id, i, { weightKg: at, reps: 3 });
      }
      await finishWorkout(s.workout.id);
    }

    const slot = async (d: string) =>
      (await db.programExercises.where({ programDayId: d }).sortBy("position"))[0];
    // 27.5 → three fails → 10% off, floored to the 2.5 step → 22.5
    expect((await slot("day-5x5-b-user-1")).workingWeightKg).toBe(22.5);
    // ...and the other day's slot follows: one lift, one ladder.
    expect((await slot("day-5x5-a-user-1")).workingWeightKg).toBe(22.5);
  });
});

/* Finding: prefill treats the in-progress workout as the last session */
describe("prefill ignores unfinished workouts", () => {
  it("routine prefill comes from the last FINISHED session, not the active one", async () => {
    const day3 = await db.programDays.get("day-routine-3-user-2");

    // Finished session at 70kg
    const first = await startWorkout(USER2, day3!.id);
    const smith1 = first.exercises.find((e) => e.exercise.name === "Smith hip thrust")!;
    await logSet(first.workout.id, USER2, smith1.exercise.id, 0, { weightKg: 70, reps: 15 });
    await finishWorkout(first.workout.id);

    // In-progress session logs 40kg (warm start) but is NOT finished
    const active = await startWorkout(USER2, day3!.id);
    const smith2 = active.exercises.find((e) => e.exercise.name === "Smith hip thrust")!;
    await logSet(active.workout.id, USER2, smith2.exercise.id, 0, { weightKg: 40, reps: 15 });

    const plan = await buildSession(USER2, day3!.id);
    const smith3 = plan.exercises.find((e) => e.exercise.name === "Smith hip thrust")!;
    expect(smith3.targets[0]).toMatchObject({ weightKg: 70, reps: 15 });
  });
});

/* Finding: logSet read-then-put races create duplicate rows */
describe("logSet is idempotent per (workout, exercise, set index)", () => {
  it("concurrent logs of the same set produce one row", async () => {
    const dayB = await db.programDays.get("day-5x5-b-user-1");
    const s = await startWorkout(USER1, dayB!.id);
    const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        logSet(s.workout.id, USER1, squat.exercise.id, 0, { weightKg: 27.5, reps: 5 }),
      ),
    );
    const sets = await db.sets.where({ workoutId: s.workout.id }).toArray();
    expect(sets).toHaveLength(1);
  });

  it("clearSet removes exactly the logged set", async () => {
    const dayB = await db.programDays.get("day-5x5-b-user-1");
    const s = await startWorkout(USER1, dayB!.id);
    const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
    await logSet(s.workout.id, USER1, squat.exercise.id, 0, { weightKg: 27.5, reps: 5 });
    await clearSet(s.workout.id, squat.exercise.id, 0);
    expect(await db.sets.where({ workoutId: s.workout.id }).count()).toBe(0);
  });
});

/* Finding: resumed workouts render as untouched — hydration helper */
describe("loadLoggedSets (resume hydration)", () => {
  it("returns everything logged for a workout", async () => {
    const dayB = await db.programDays.get("day-5x5-b-user-1");
    const s = await startWorkout(USER1, dayB!.id);
    const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
    await logSet(s.workout.id, USER1, squat.exercise.id, 0, { weightKg: 27.5, reps: 5 });
    await logSet(s.workout.id, USER1, squat.exercise.id, 1, { weightKg: 27.5, reps: 4 });

    const logged = await loadLoggedSets(s.workout.id);
    expect(logged).toHaveLength(2);
    expect(logged.find((x) => x.setIndex === 1)?.reps).toBe(4);
  });
});

/* Finding: finishing an empty workout consumes the day / leaves junk */
describe("finishing a workout with zero sets discards it", () => {
  it("deletes the empty workout and does not advance the rotation", async () => {
    const first = await nextProgramDay(USER1);
    expect(first?.name).toBe("Workout A");
    const s = await startWorkout(USER1, first!.id);
    await finishWorkout(s.workout.id);
    expect(await db.workouts.get(s.workout.id)).toBeUndefined();
    const next = await nextProgramDay(USER1);
    expect(next?.name).toBe("Workout A");
  });
});

/* Finding/regime: user-configurable success rest (SL default 1:30) */
describe("rest timer default setting", () => {
  it("overrides program-mode rest, but not explicit per-exercise rest", async () => {
    const { restDefaultKey } = await import("./session");
    await db.settings.put({ key: restDefaultKey(USER1), value: 120 });
    const plan = await buildSession(USER1, "day-5x5-b-user-1");
    const squat = plan.exercises.find((e) => e.exercise.name === "Squat")!;
    expect(squat.restSeconds).toBe(120);
    const deadlift = plan.exercises.find((e) => e.exercise.name === "Deadlift")!;
    expect(deadlift.restSeconds).toBe(180); // explicit pe.restSeconds wins
  });

  it("routine-mode per-exercise rests are untouched by the setting", async () => {
    const { restDefaultKey } = await import("./session");
    await db.settings.put({ key: restDefaultKey(USER2), value: 45 });
    const plan = await buildSession(USER2, "day-routine-3-user-2");
    const smith = plan.exercises.find((e) => e.exercise.name === "Smith hip thrust")!;
    expect(smith.restSeconds).toBe(120);
  });
});

/* Regime: floor pulls (deadlift/row) get no empty-bar warmups */
describe("warmup styles per exercise", () => {
  it("deadlift warmups start from the floor, squat/bench include bar sets", async () => {
    const plan = await buildSession(USER1, "day-5x5-b-user-1");
    const deadlift = plan.exercises.find((e) => e.exercise.name === "Deadlift")!;
    expect(deadlift.warmups[0].weightKg).toBeGreaterThanOrEqual(40);
    const ohp = plan.exercises.find((e) => e.exercise.name === "Overhead press")!;
    expect(ohp.warmups[0]).toEqual({ reps: 5, weightKg: 20 });
    expect(ohp.warmups[1]).toEqual({ reps: 5, weightKg: 20 });
  });
});

/* Roadmap: body weight carries forward at EVENT time (startWorkout), not
 * in a component effect */
describe("startWorkout stamps the last known body weight", () => {
  it("a new workout is born with the previous workout's body weight", async () => {
    const dayA = await db.programDays.get("day-5x5-a-user-1");
    const first = await startWorkout(USER1, dayA!.id);
    await db.workouts.update(first.workout.id, { bodyWeightKg: 97.75 });
    const squat = first.exercises[0];
    await logSet(first.workout.id, USER1, squat.exercise.id, 0, { weightKg: 25, reps: 5 });
    await finishWorkout(first.workout.id);

    const second = await startWorkout(USER1, "day-5x5-b-user-1");
    expect(second.workout.bodyWeightKg).toBe(97.75);
    expect((await db.workouts.get(second.workout.id))?.bodyWeightKg).toBe(97.75);
  });

  it("stays empty when the user has never recorded body weight", async () => {
    const dayA = await db.programDays.get("day-5x5-a-user-1");
    const s = await startWorkout(USER1, dayA!.id);
    expect(s.workout.bodyWeightKg).toBeUndefined();
  });
});

/** StrongLifts trains one lift across several days — squat every session on
 * A/B — and that is ONE ladder, not one per day. The engine derives this from
 * the program's mode rather than a flag someone has to remember to set:
 * leaving it off makes the slots drift apart at half speed, which lifters
 * then hand-sync (and, when they can't, fake a workout to force). Madcow has
 * always linked unconditionally — see advanceMadcowTops. */
describe("linked progression", () => {
  it("links a lift across days for a StrongLifts program, with no flag set", async () => {
    const dayB = await db.programDays.get("day-5x5-b-user-1");
    const s = await startWorkout(USER1, dayB!.id);
    const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
    for (let i = 0; i < 5; i++) {
      await logSet(s.workout.id, USER1, squat.exercise.id, i, { weightKg: 20, reps: 5 });
    }
    await finishWorkout(s.workout.id);

    const aSlot = (await db.programExercises.where({ programDayId: "day-5x5-a-user-1" }).sortBy("position"))[0];
    const bSlot = (await db.programExercises.where({ programDayId: "day-5x5-b-user-1" }).sortBy("position"))[0];
    expect(bSlot.workingWeightKg).toBe(22.5);
    expect(aSlot.workingWeightKg).toBe(22.5); // day A's squat follows day B's session
  });

  it("a success advances every slot of the exercise across days", async () => {
    await db.programs.update("program-5x5-user-1", { linkedProgression: true });
    const dayB = await db.programDays.get("day-5x5-b-user-1");
    const s = await startWorkout(USER1, dayB!.id);
    const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
    for (let i = 0; i < 5; i++) {
      await logSet(s.workout.id, USER1, squat.exercise.id, i, { weightKg: 27.5, reps: 5 });
    }
    await finishWorkout(s.workout.id);

    const bSlot = (await db.programExercises.where({ programDayId: "day-5x5-b-user-1" }).sortBy("position"))[0];
    const aSlot = (await db.programExercises.where({ programDayId: "day-5x5-a-user-1" }).sortBy("position"))[0];
    expect(bSlot.workingWeightKg).toBe(30);
    expect(aSlot.workingWeightKg).toBe(30); // linked: day A follows
  });

  it("stays per-slot when a program explicitly opts out", async () => {
    await db.programs.update("program-5x5-user-1", { linkedProgression: false });
    const dayB = await db.programDays.get("day-5x5-b-user-1");
    const s = await startWorkout(USER1, dayB!.id);
    const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
    for (let i = 0; i < 5; i++) {
      await logSet(s.workout.id, USER1, squat.exercise.id, i, { weightKg: 27.5, reps: 5 });
    }
    await finishWorkout(s.workout.id);
    const aSlot = (await db.programExercises.where({ programDayId: "day-5x5-a-user-1" }).sortBy("position"))[0];
    expect(aSlot.workingWeightKg).toBe(25); // untouched
  });
});

/* Roadmap: stall protocol 5×5 → 3×5 → 1×5 */
describe("stall protocol", () => {
  async function failThreeSessions(weight: number) {
    for (let round = 0; round < 3; round++) {
      const s = await startWorkout(USER1, "day-5x5-b-user-1");
      const ohp = s.exercises.find((e) => e.exercise.name === "Overhead press")!;
      const sets = ohp.programExercise.sets;
      for (let i = 0; i < sets; i++) {
        await logSet(s.workout.id, USER1, ohp.exercise.id, i, { weightKg: weight, reps: 2 });
      }
      await finishWorkout(s.workout.id);
    }
  }
  async function ohpSlot() {
    const pes = await db.programExercises.where({ programDayId: "day-5x5-b-user-1" }).sortBy("position");
    return pes[1];
  }

  it("drops 5×5 to 3×5 after the second deload, then 1×5 after the third", async () => {
    await failThreeSessions(40); // deload #1 → 35
    let pe = await ohpSlot();
    expect(pe.workingWeightKg).toBe(35);
    expect(pe.sets).toBe(5); // first deload: keep 5×5

    await failThreeSessions(35); // deload #2 → 30 → 3×5
    pe = await ohpSlot();
    expect(pe.workingWeightKg).toBe(30);
    expect(pe.sets).toBe(3);

    await failThreeSessions(30); // deload #3 → 27.5? floor(27/2.5)=27.5→ 3×5→1×5
    pe = await ohpSlot();
    expect(pe.sets).toBe(1);
  });

  it("leaves accessory schemes (3×10) alone", async () => {
    // pullups: 3×10 assisted — repeated deloads must not shrink its sets
    for (let round = 0; round < 9; round++) {
      const s = await startWorkout(USER1, "day-5x5-b-user-1");
      const pullups = s.exercises.find((e) => e.exercise.name === "Pullups")!;
      for (let i = 0; i < pullups.programExercise.sets; i++) {
        await logSet(s.workout.id, USER1, pullups.exercise.id, i, { weightKg: -2.5, reps: 4 });
      }
      await finishWorkout(s.workout.id);
    }
    const pes = await db.programExercises.where({ programDayId: "day-5x5-b-user-1" }).sortBy("position");
    const pullupsPe = pes[3];
    expect(pullupsPe.sets).toBe(3);
  });
});

/* End-to-end acceptance: the FULL real export reaches the store intact.
 * Gated on LIFTLOG_SL_EXPORT (see realfiles.test.ts). */
describe.skipIf(!process.env.LIFTLOG_SL_EXPORT)("real export → store", () => {
  it("stores every workout from the real StrongLifts file", async () => {
    const { readFileSync } = await import("node:fs");
    const parsed = parseStrongLiftsCsv(
      readFileSync(process.env.LIFTLOG_SL_EXPORT!, "utf8"),
    );
    const summary = await importIntoStore(USER1, parsed);
    expect(summary.workoutsAdded).toBe(parsed.workouts.length);
    expect(summary.workoutsSkipped).toBe(0);
    expect(await db.workouts.where({ userId: USER1 }).count()).toBe(
      parsed.workouts.length,
    );
  });
});

/* Finding: export CSV is lossy and non-restorable — JSON backup round-trip */
describe("backup and restore", () => {
  it("round-trips all user data through JSON", async () => {
    const dayB = await db.programDays.get("day-5x5-b-user-1");
    const s = await startWorkout(USER1, dayB!.id);
    const squat = s.exercises.find((e) => e.exercise.name === "Squat")!;
    for (let i = 0; i < 5; i++) {
      await logSet(s.workout.id, USER1, squat.exercise.id, i, { weightKg: 27.5, reps: 5 });
    }
    await finishWorkout(s.workout.id);

    const json = await exportBackup(USER1);

    // Simulate a fresh device
    await db.delete();
    await db.open();
    await seedIfEmpty();

    const summary = await restoreBackup(USER1, json);
    expect(summary.workouts).toBe(1);
    const workouts = await db.workouts.where({ userId: USER1 }).toArray();
    expect(workouts).toHaveLength(1);
    const sets = await db.sets.where({ userId: USER1 }).toArray();
    expect(sets).toHaveLength(5);
    expect(sets[0].weightKg).toBe(27.5);
    // program state restored too (squat advanced to 30 before backup)
    const pes = await db.programExercises.where({ programDayId: "day-5x5-b-user-1" }).toArray();
    const squatPe = pes.find((pe) => pe.position === 0)!;
    expect(squatPe.workingWeightKg).toBe(30);
  });
});
