"use client";

/** First-run seed. Identities come from config (env), never from code —
 * the repo carries only generic program templates. */

import { db, newId } from "./db";
import { loadUserConfig, type UserConfig, type FiveByFiveSlot } from "@/config/users";
import type { Exercise, ProgramExercise } from "@/lib/types";

export async function seedIfEmpty(): Promise<void> {
  const count = await db.users.count();
  if (count > 0) return;
  const users = loadUserConfig();
  await db.transaction(
    "rw",
    [db.users, db.exercises, db.programs, db.programDays, db.programExercises],
    async () => {
      await db.users.bulkAdd(
        users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          accent: u.accent,
          unit: u.unit,
        })),
      );
      for (const u of users) {
        if (u.template === "fiveByFive") await seedFiveByFive(u);
        else await seedRoutine(u);
      }
    },
  );
}

/** Program mode template: classic 5×5 A/B with linear progression. */
async function seedFiveByFive(user: UserConfig) {
  const w = (slot: FiveByFiveSlot, fallback: number): number =>
    user.workingWeights?.[slot] ?? fallback;

  const ex = (name: string, kind: Exercise["kind"] = "weighted", restSeconds = 90): Exercise => ({
    id: newId(),
    userId: user.id,
    name,
    kind,
    restSeconds,
  });

  const squat = ex("Squat");
  const bench = ex("Bench press");
  const row = ex("Barbell row");
  const ohp = ex("Overhead press");
  const deadlift = ex("Deadlift", "weighted", 180);
  const dips = ex("Dips");
  const pushups = ex("Push ups", "bodyweight");
  const pullups = ex("Pullups");
  const chinups = ex("Chinups");
  await db.exercises.bulkAdd([
    squat, bench, row, ohp, deadlift, dips, pushups, pullups, chinups,
  ]);

  const programId = `program-5x5-${user.id}`;
  await db.programs.add({
    id: programId,
    userId: user.id,
    name: "5×5 A/B",
    mode: "progression",
  });

  const dayA = { id: `day-5x5-a-${user.id}`, programId, position: 0, name: "Workout A" };
  const dayB = { id: `day-5x5-b-${user.id}`, programId, position: 1, name: "Workout B" };
  await db.programDays.bulkAdd([dayA, dayB]);

  const pe = (
    dayId: string,
    exercise: Exercise,
    position: number,
    partial: Partial<ProgramExercise>,
  ): ProgramExercise => ({
    id: newId(),
    programDayId: dayId,
    exerciseId: exercise.id,
    position,
    sets: 5,
    targetReps: 5,
    incrementKg: 2.5,
    deloadPct: 0.1,
    deloadAfterFails: 3,
    ...partial,
  });

  await db.programExercises.bulkAdd([
    pe(dayA.id, squat, 0, { workingWeightKg: w("squatA", 20) }),
    pe(dayA.id, bench, 1, { workingWeightKg: w("bench", 20) }),
    pe(dayA.id, row, 2, { workingWeightKg: w("row", 30) }),
    pe(dayA.id, dips, 3, { sets: 3, targetReps: 10, workingWeightKg: w("dips", 0) }),
    pe(dayA.id, pushups, 4, { sets: 3, targetReps: 10, incrementKg: 0 }),
    pe(dayB.id, squat, 0, { workingWeightKg: w("squatB", 20) }),
    pe(dayB.id, ohp, 1, { workingWeightKg: w("ohp", 20) }),
    pe(dayB.id, deadlift, 2, {
      sets: 1,
      incrementKg: 5,
      workingWeightKg: w("deadlift", 40),
      restSeconds: 180,
    }),
    pe(dayB.id, pullups, 3, { sets: 3, targetReps: 10, workingWeightKg: w("pullups", 0) }),
    pe(dayB.id, chinups, 4, { sets: 3, targetReps: 10, workingWeightKg: w("chinups", 0) }),
  ]);
}

/** Routine mode template: 3-day lower-body/glute split with mixed set kinds
 * (weighted, bodyweight, timed) and per-exercise rest. */
async function seedRoutine(user: UserConfig) {
  const ex = (
    name: string,
    kind: Exercise["kind"],
    restSeconds: number,
    note?: string,
  ): Exercise => ({ id: newId(), userId: user.id, name, kind, restSeconds, note });

  const catcow = ex("Cat-cow stretch", "bodyweight", 30);
  const deadbug = ex("Dead bug", "bodyweight", 30);
  const birddog = ex("Bird dog w/ pause", "bodyweight", 30);
  const tuckjumps = ex("Tuck jumps", "bodyweight", 60);
  const hipthrust = ex("Hip thrust (Barbell)", "weighted", 120);
  const bbsquat = ex("Squat (Barbell)", "weighted", 120);
  const slhipthrust = ex("Single leg hip thrust", "bodyweight", 120);
  const bandedsteps = ex("Banded lateral steps", "bodyweight", 60);
  const treadmill = ex("Running (Treadmill)", "timed", 0);
  const smiththrust = ex("Smith hip thrust", "weighted", 120);
  const bulgarian = ex("Bulgarian split squat", "weighted", 120);
  const revhyper = ex("Reverse hyperextensions", "weighted", 120);
  const abductor = ex("Hip abductor (Machine)", "weighted", 60);
  const lunges = ex("Walking lunges", "bodyweight", 60);
  const plank = ex("Plank", "timed", 60);

  await db.exercises.bulkAdd([
    catcow, deadbug, birddog, tuckjumps, hipthrust, bbsquat,
    slhipthrust, bandedsteps,
    treadmill, smiththrust, bulgarian, revhyper, abductor, lunges, plank,
  ]);

  const programId = `program-routine-${user.id}`;
  await db.programs.add({
    id: programId,
    userId: user.id,
    name: "3-Day Split",
    mode: "routine",
  });

  const d1 = { id: `day-routine-1-${user.id}`, programId, position: 0, name: "Day 1 · Strength & Posterior Chain" };
  const d2 = { id: `day-routine-2-${user.id}`, programId, position: 1, name: "Day 2 · Glute Medius" };
  const d3 = { id: `day-routine-3-${user.id}`, programId, position: 2, name: "Day 3 · Quad Glute Combo" };
  await db.programDays.bulkAdd([d1, d2, d3]);

  const pe = (
    dayId: string,
    exercise: Exercise,
    position: number,
    sets: number,
    partial: Partial<ProgramExercise> = {},
  ): ProgramExercise => ({
    id: newId(),
    programDayId: dayId,
    exerciseId: exercise.id,
    position,
    sets,
    ...partial,
  });

  await db.programExercises.bulkAdd([
    pe(d1.id, catcow, 0, 1, { targetReps: 15 }),
    pe(d1.id, deadbug, 1, 3, { targetReps: 10 }),
    pe(d1.id, birddog, 2, 3, { targetReps: 10 }),
    pe(d1.id, tuckjumps, 3, 3, { targetReps: 5 }),
    pe(d1.id, hipthrust, 4, 3, { targetReps: 10 }),
    pe(d1.id, bbsquat, 5, 2, { targetReps: 10 }),
    pe(d2.id, catcow, 0, 1, { targetReps: 15 }),
    pe(d2.id, deadbug, 1, 2, { targetReps: 10 }),
    pe(d2.id, birddog, 2, 2, { targetReps: 10 }),
    pe(d2.id, slhipthrust, 3, 3, { targetReps: 15 }),
    pe(d2.id, bandedsteps, 4, 3, { targetReps: 20 }),
    pe(d3.id, treadmill, 0, 1, { targetSeconds: 420 }),
    pe(d3.id, deadbug, 1, 3, { targetReps: 10 }),
    pe(d3.id, birddog, 2, 3, { targetReps: 10 }),
    pe(d3.id, smiththrust, 3, 3, { targetReps: 15 }),
    pe(d3.id, bulgarian, 4, 3, { targetReps: 8 }),
    pe(d3.id, revhyper, 5, 3, { targetReps: 12 }),
    pe(d3.id, abductor, 6, 4, { targetReps: 15 }),
    pe(d3.id, lunges, 7, 3, { targetReps: 10 }),
    pe(d3.id, plank, 8, 3, { targetSeconds: 60 }),
  ]);
}
