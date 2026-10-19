/** Test fixture: the two lifters the engine specs were written against, seeded
 * the way the app used to seed them from config. Production seeds a single
 * account from a program template (src/db/account.ts); these fixed rows (5×5
 * A/B with known weights, and a 3-day routine) are what the specs assert. */

import { db } from "@/db/db";

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
import type { Exercise, ProgramExercise } from "@/lib/types";

export type FiveByFiveSlot =
  | "squatA"
  | "bench"
  | "row"
  | "dips"
  | "squatB"
  | "ohp"
  | "deadlift"
  | "pullups"
  | "chinups";

export interface UserConfig {
  id: string;
  name: string;
  email: string;
  accent: "blue" | "green";
  unit: "kg" | "lb";
  template: "fiveByFive" | "routine";
  theme?: "dark" | "light";
  /** fiveByFive only: starting working weights (kg) per slot. */
  workingWeights?: Partial<Record<FiveByFiveSlot, number>>;
}

function themeForConfig(cfg: UserConfig): "dark" | "light" {
  return cfg.theme ?? (cfg.template === "routine" ? "light" : "dark");
}

export const TEST_USERS: UserConfig[] = [
  {
    id: "user-1",
    name: "Lifter One",
    email: "lifter-one@example.com",
    accent: "blue",
    unit: "kg",
    template: "fiveByFive",
    workingWeights: {
      squatA: 25,
      bench: 62.5,
      row: 80,
      dips: 2.5,
      squatB: 27.5,
      ohp: 40,
      deadlift: 120,
      pullups: -2.5,
      chinups: -2.5,
    },
  },
  {
    id: "user-2",
    name: "Lifter Two",
    email: "lifter-two@example.com",
    accent: "green",
    unit: "kg",
    template: "routine",
  },
];

export async function seedIfEmpty(config: UserConfig[] = TEST_USERS): Promise<void> {
  const users = config;
  await db.transaction(
    "rw",
    [db.users, db.exercises, db.programs, db.programDays, db.programExercises],
    async () => {
      // Emptiness check INSIDE the transaction — concurrent callers (two
      // tabs, StrictMode double-effects) must not both seed.
      const count = await db.users.count();
      if (count > 0) return;
      await db.users.bulkAdd(
        users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          accent: u.accent,
          unit: u.unit,
          theme: themeForConfig(u),
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
    // Deterministic ids: every device seeds identical ids, so synced ops
    // can reference exercises across devices.
    id: `ex-${user.id}-${slug(name)}`,
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
    templateId: "5x5",
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
    id: `pe-${dayId}-${position}`,
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
    // Bodyweight accessories are MANUAL (incrementKg 0): you progress these
    // by hand and much more slowly than the barbell lifts, so they never
    // auto-add weight and stay out of linked progression (the engine skips
    // any slot with no increment).
    pe(dayA.id, dips, 3, { sets: 3, targetReps: 10, incrementKg: 0, workingWeightKg: w("dips", 0) }),
    pe(dayA.id, pushups, 4, { sets: 3, targetReps: 10, incrementKg: 0 }),
    pe(dayB.id, squat, 0, { workingWeightKg: w("squatB", 20) }),
    pe(dayB.id, ohp, 1, { workingWeightKg: w("ohp", 20) }),
    pe(dayB.id, deadlift, 2, {
      sets: 1,
      incrementKg: 5,
      workingWeightKg: w("deadlift", 40),
      restSeconds: 180,
    }),
    pe(dayB.id, pullups, 3, { sets: 3, targetReps: 10, incrementKg: 0, workingWeightKg: w("pullups", 0) }),
    pe(dayB.id, chinups, 4, { sets: 3, targetReps: 10, incrementKg: 0, workingWeightKg: w("chinups", 0) }),
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
  ): Exercise => ({ id: `ex-${user.id}-${slug(name)}`, userId: user.id, name, kind, restSeconds, note });

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
    templateId: "routine",
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
    id: `pe-${dayId}-${position}`,
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
