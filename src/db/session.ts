"use client";

/** Session orchestration: build today's targets (both modes), log sets,
 * finish workouts, advance progression. */

import { db, newId } from "./db";
import type {
  Exercise,
  ProgramDay,
  ProgramExercise,
  SetEntry,
  Workout,
} from "@/lib/types";
import { nextWorkingWeight } from "@/lib/progression";
import { prefillFromLastSession, type SetPrefill } from "@/lib/prefill";
import { warmupRamp, type WarmupSet } from "@/lib/plates";

export interface SessionExercise {
  programExercise: ProgramExercise;
  exercise: Exercise;
  /** Per-set targets (weight/reps/seconds) — prescribed or prefilled. */
  targets: SetPrefill[];
  warmups: WarmupSet[];
  restSeconds: number;
}

export interface Session {
  workout: Workout;
  day: ProgramDay;
  mode: "progression" | "routine";
  exercises: SessionExercise[];
}

/** The day the user should do next: after their last workout's day, in
 * program order; the first day when there's no history. */
export async function nextProgramDay(userId: string): Promise<ProgramDay | undefined> {
  const program = await db.programs.where({ userId }).first();
  if (!program) return undefined;
  const days = await db.programDays
    .where({ programId: program.id })
    .sortBy("position");
  if (days.length === 0) return undefined;

  const workouts = await db.workouts.where({ userId }).sortBy("date");
  const finished = workouts.filter((w) => w.endTs !== undefined);
  const last = finished[finished.length - 1];
  if (!last?.programDayId) return days[0];

  const idx = days.findIndex((d) => d.id === last.programDayId);
  return days[(idx + 1) % days.length];
}

/** Assemble targets for a day without writing anything. */
export async function buildSessionPlan(
  userId: string,
  dayId: string,
): Promise<Omit<Session, "workout">> {
  const day = await db.programDays.get(dayId);
  if (!day) throw new Error(`Unknown program day ${dayId}`);
  const program = await db.programs.get(day.programId);
  if (!program) throw new Error(`Unknown program ${day.programId}`);

  const pes = await db.programExercises
    .where({ programDayId: dayId })
    .sortBy("position");
  const history = await db.sets.where({ userId }).toArray();

  const exercises: SessionExercise[] = [];
  for (const pe of pes) {
    const exercise = await db.exercises.get(pe.exerciseId);
    if (!exercise) continue;

    let targets: SetPrefill[];
    let warmups: WarmupSet[] = [];

    if (program.mode === "progression") {
      const weightKg = pe.workingWeightKg;
      targets = Array.from({ length: pe.sets }, () => ({
        weightKg,
        reps: pe.targetReps,
        seconds: pe.targetSeconds,
      }));
      if (exercise.kind === "weighted" && weightKg !== undefined && weightKg > 0) {
        warmups = warmupRamp(weightKg, 20);
      }
    } else {
      targets = prefillFromLastSession(history, pe.exerciseId, pe.sets);
      // Fall back to program targets when never done before.
      targets = targets.map((t) => ({
        weightKg: t.weightKg,
        reps: t.reps ?? pe.targetReps,
        seconds: t.seconds ?? pe.targetSeconds,
      }));
    }

    exercises.push({
      programExercise: pe,
      exercise,
      targets,
      warmups,
      restSeconds: pe.restSeconds ?? exercise.restSeconds,
    });
  }

  return { day, mode: program.mode, exercises };
}

/** Create the workout row and return the full session. */
export async function startWorkout(userId: string, dayId: string): Promise<Session> {
  const plan = await buildSessionPlan(userId, dayId);
  const workout: Workout = {
    id: newId(),
    userId,
    programDayId: dayId,
    dayLabel: plan.day.name,
    date: new Date().toISOString().slice(0, 10),
    startTs: Date.now(),
  };
  await db.workouts.add(workout);
  return { workout, ...plan };
}

/** Alias used by read-only screens. */
export const buildSession = async (userId: string, dayId: string) => {
  const plan = await buildSessionPlan(userId, dayId);
  return plan;
};

export interface LoggedValues {
  weightKg?: number;
  reps?: number;
  seconds?: number;
  isWarmup?: boolean;
  note?: string;
  targetReps?: number;
  targetSeconds?: number;
}

/** Upsert one set (keyed by workout + exercise + index). */
export async function logSet(
  workoutId: string,
  userId: string,
  exerciseId: string,
  setIndex: number,
  values: LoggedValues,
): Promise<SetEntry> {
  const existing = await db.sets
    .where({ workoutId })
    .and((s) => s.exerciseId === exerciseId && s.setIndex === setIndex)
    .first();

  const entry: SetEntry = {
    id: existing?.id ?? newId(),
    workoutId,
    userId,
    exerciseId,
    setIndex,
    isWarmup: values.isWarmup ?? false,
    targetReps: values.targetReps ?? existing?.targetReps,
    targetSeconds: values.targetSeconds ?? existing?.targetSeconds,
    weightKg: values.weightKg,
    reps: values.reps,
    seconds: values.seconds,
    note: values.note ?? existing?.note,
    completedTs: Date.now(),
  };
  await db.sets.put(entry);
  return entry;
}

/** Remove a set the user un-logged. */
export async function clearSet(
  workoutId: string,
  exerciseId: string,
  setIndex: number,
): Promise<void> {
  const existing = await db.sets
    .where({ workoutId })
    .and((s) => s.exerciseId === exerciseId && s.setIndex === setIndex)
    .first();
  if (existing) await db.sets.delete(existing.id);
}

/** Close the workout; in program mode, advance working weights. */
export async function finishWorkout(workoutId: string): Promise<void> {
  const workout = await db.workouts.get(workoutId);
  if (!workout) return;
  await db.workouts.update(workoutId, { endTs: Date.now() });
  if (!workout.programDayId) return;

  const day = await db.programDays.get(workout.programDayId);
  const program = day ? await db.programs.get(day.programId) : undefined;
  if (!program || program.mode !== "progression") return;

  const pes = await db.programExercises
    .where({ programDayId: workout.programDayId })
    .toArray();
  const sets = await db.sets.where({ workoutId }).toArray();

  for (const pe of pes) {
    if (pe.workingWeightKg === undefined || !pe.incrementKg) continue;
    const workSets = sets.filter((s) => s.exerciseId === pe.exerciseId && !s.isWarmup);
    if (workSets.length === 0) continue; // untouched exercise: no change

    const success =
      workSets.length >= pe.sets &&
      workSets.every((s) => (s.reps ?? 0) >= (pe.targetReps ?? 0));

    const next = nextWorkingWeight(
      {
        incrementKg: pe.incrementKg,
        deloadPct: pe.deloadPct ?? 0.1,
        deloadAfterFails: pe.deloadAfterFails ?? 3,
      },
      await sessionHistory(pe, success),
    );
    if (next !== undefined) {
      await db.programExercises.update(pe.id, { workingWeightKg: next });
    }
  }
}

/** Reconstruct success/fail history for an exercise at its recent weights.
 * Stored compactly on the program exercise row via failCount metadata would
 * be an alternative; deriving from sets keeps a single source of truth. */
async function sessionHistory(
  pe: ProgramExercise,
  latestSuccess: boolean,
): Promise<{ weightKg: number; success: boolean }[]> {
  const all = await db.sets
    .where("exerciseId")
    .equals(pe.exerciseId)
    .toArray()
    .catch(() => [] as SetEntry[]);
  // Group prior sets by workout, oldest first, at any weight.
  const byWorkout = new Map<string, SetEntry[]>();
  for (const s of all) {
    if (s.isWarmup) continue;
    const list = byWorkout.get(s.workoutId) ?? [];
    list.push(s);
    byWorkout.set(s.workoutId, list);
  }
  const sessions: { weightKg: number; success: boolean; ts: number }[] = [];
  for (const sets of byWorkout.values()) {
    const ts = Math.max(...sets.map((s) => s.completedTs ?? 0));
    const weightKg = sets[0].weightKg ?? 0;
    const success =
      sets.length >= pe.sets &&
      sets.every((s) => (s.reps ?? 0) >= (pe.targetReps ?? 0));
    sessions.push({ weightKg, success, ts });
  }
  sessions.sort((a, b) => a.ts - b.ts);
  if (sessions.length === 0) {
    return [{ weightKg: pe.workingWeightKg ?? 0, success: latestSuccess }];
  }
  return sessions.map(({ weightKg, success }) => ({ weightKg, success }));
}
