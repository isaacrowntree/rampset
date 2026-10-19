/** The load-bearing guarantee: switching program templates (in any
 * direction, at any time) preserves ALL history and keeps every feature
 * working. History = workouts + sets; identity = exercise ids. */

import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "./db";
import { seedIfEmpty } from "@/test/seed";
import { startWorkout, logSet, finishWorkout, buildSessionPlan } from "./session";
import {
  switchProgram,
  captureWorkingWeights,
  exerciseId,
} from "./programSwitch";
import { PROGRAM_TEMPLATES, getTemplate } from "@/lib/programTemplates";

const USER = "user-1";

async function programDays(userId: string) {
  const program = await db.programs.where({ userId }).first();
  if (!program) return [];
  return db.programDays.where({ programId: program.id }).sortBy("position");
}

/** Log a full workout on the user's next day so there is real history. */
async function trainSquat(userId: string, reps = 5): Promise<string> {
  const days = await programDays(userId);
  const day = days[0];
  const session = await startWorkout(userId, day.id);
  const squatId = exerciseId(userId, "Squat");
  await logSet(session.workout.id, userId, squatId, 0, { weightKg: 60, reps });
  await finishWorkout(session.workout.id);
  return session.workout.id;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedIfEmpty();
});

describe("switchProgram — history & identity preservation", () => {
  it("keeps every workout and set when switching templates", async () => {
    await trainSquat(USER);
    await trainSquat(USER);
    const workoutsBefore = await db.workouts.where({ userId: USER }).count();
    const setsBefore = await db.sets.where({ userId: USER }).count();
    expect(workoutsBefore).toBe(2);

    await switchProgram(USER, "plus");

    expect(await db.workouts.where({ userId: USER }).count()).toBe(workoutsBefore);
    expect(await db.sets.where({ userId: USER }).count()).toBe(setsBefore);
  });

  it("reuses the same exercise ids, so history stays linked", async () => {
    const squatId = exerciseId(USER, "Squat");
    await trainSquat(USER);
    const setsForSquat = await db.sets
      .where({ userId: USER })
      .and((s) => s.exerciseId === squatId)
      .count();
    expect(setsForSquat).toBeGreaterThan(0);

    await switchProgram(USER, "mini");

    // Same exercise row, same id — the logged sets still point at it.
    const squat = await db.exercises.get(squatId);
    expect(squat?.name).toBe("Squat");
    const stillLinked = await db.sets
      .where({ userId: USER })
      .and((s) => s.exerciseId === squatId)
      .count();
    expect(stillLinked).toBe(setsForSquat);
  });

  it("carries the working weight forward to the new program", async () => {
    // Bump Squat's working weight, then switch.
    const squatId = exerciseId(USER, "Squat");
    const days = await programDays(USER);
    const pes = await db.programExercises.where({ programDayId: days[0].id }).toArray();
    const squatPe = pes.find((p) => p.exerciseId === squatId)!;
    await db.programExercises.update(squatPe.id, { workingWeightKg: 82.5 });

    await switchProgram(USER, "lite");

    const newDays = await programDays(USER);
    const newPes = await db.programExercises
      .where({ programDayId: newDays[0].id })
      .toArray();
    const newSquat = newPes.find((p) => p.exerciseId === squatId)!;
    expect(newSquat.workingWeightKg).toBe(82.5);
  });

  it("is lossless switching back and forth", async () => {
    await trainSquat(USER);
    await trainSquat(USER);
    const workouts = await db.workouts.where({ userId: USER }).count();
    const sets = await db.sets.where({ userId: USER }).count();

    await switchProgram(USER, "ultra");
    await switchProgram(USER, "5x5");
    await switchProgram(USER, "mini");
    await switchProgram(USER, "5x5");

    expect(await db.workouts.where({ userId: USER }).count()).toBe(workouts);
    expect(await db.sets.where({ userId: USER }).count()).toBe(sets);
    const program = await db.programs.where({ userId: USER }).first();
    expect(program?.templateId).toBe("5x5");
  });

  it("leaves exactly one program (old structure replaced, not duplicated)", async () => {
    await switchProgram(USER, "plus");
    await switchProgram(USER, "ultra");
    expect(await db.programs.where({ userId: USER }).count()).toBe(1);
  });

  it("keeps the app working after a switch: a plan builds and a workout logs", async () => {
    await switchProgram(USER, "ultra");
    const days = await programDays(USER);
    expect(days.length).toBe(4);

    const session = await startWorkout(USER, days[0].id);
    expect(session.exercises.length).toBeGreaterThan(0);
    const plan = await buildSessionPlan(USER, days[0].id);
    expect(plan.exercises[0].targets.length).toBeGreaterThan(0);

    // Logging still works end to end.
    await logSet(session.workout.id, USER, session.exercises[0].exercise.id, 0, {
      weightKg: 40,
      reps: 5,
    });
    await finishWorkout(session.workout.id);
    expect(await db.workouts.where({ userId: USER }).count()).toBe(1);
  });

  it("rejects an unknown template id", async () => {
    await expect(switchProgram(USER, "nope")).rejects.toThrow();
  });
});

describe("captureWorkingWeights", () => {
  it("keeps the heaviest weight per exercise across days", async () => {
    const squatId = exerciseId(USER, "Squat");
    const days = await programDays(USER);
    // 5×5 has Squat on both A and B — set different weights.
    for (const [i, day] of days.entries()) {
      const pes = await db.programExercises.where({ programDayId: day.id }).toArray();
      const squat = pes.find((p) => p.exerciseId === squatId);
      if (squat) await db.programExercises.update(squat.id, { workingWeightKg: 50 + i * 10 });
    }
    const weights = await captureWorkingWeights(USER);
    expect(weights.get(squatId)).toBe(60); // the heavier of 50 / 60
  });
});

describe("PROGRAM_TEMPLATES registry", () => {
  it("every template is well-formed", () => {
    for (const t of PROGRAM_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.days.length).toBeGreaterThan(0);
      for (const d of t.days) {
        expect(d.key).toBeTruthy();
        // A custom routine starts empty; every guided program prescribes.
        if (t.mode !== "routine") expect(d.exercises.length).toBeGreaterThan(0);
        for (const e of d.exercises) {
          expect(e.name).toBeTruthy();
          expect(e.sets).toBeGreaterThan(0);
          if (e.kind === "timed") expect(e.seconds ?? e.reps).toBeTruthy();
          else expect(e.reps).toBeGreaterThan(0);
        }
      }
    }
  });

  it("has unique template ids and day keys within each template", () => {
    const ids = PROGRAM_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of PROGRAM_TEMPLATES) {
      const keys = t.days.map((d) => d.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("classic 5×5 matches the seeded structure (ids stay stable)", async () => {
    // The seed built a 5×5 program; switching to "5x5" should reproduce the
    // same deterministic program/day ids the seed uses.
    await switchProgram(USER, "5x5");
    expect(await db.programs.get(`program-5x5-${USER}`)).toBeDefined();
    expect(await db.programDays.get(`day-5x5-a-${USER}`)).toBeDefined();
    expect(await db.programDays.get(`day-5x5-b-${USER}`)).toBeDefined();
    expect(getTemplate("5x5")!.name).toBe("StrongLifts 5×5");
  });
});
