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
import { rampForRole, nextTop, topSetIndex, type MadcowRole } from "@/lib/madcow";
import { prefillFromLastSession, type SetPrefill } from "@/lib/prefill";
import { warmupRamp, type WarmupSet } from "@/lib/plates";

/** Deadlifts and rows warm up from the floor — no empty-bar sets. */
function warmupStyle(exerciseName: string): "bar" | "floor" {
  return /deadlift|row/i.test(exerciseName) ? "floor" : "bar";
}

/** Settings key for a user's preferred success rest (seconds). */
export function restDefaultKey(userId: string): string {
  return `restDefault:${userId}`;
}

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
  mode: "progression" | "routine" | "madcow";
  exercises: SessionExercise[];
}

/** Deterministic set id: logging the same set twice upserts one row. */
export function setId(workoutId: string, exerciseId: string, setIndex: number): string {
  return `${workoutId}#${exerciseId}#${setIndex}`;
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

  const restSetting = await db.settings.get(restDefaultKey(userId));
  const restDefault =
    typeof restSetting?.value === "number" && restSetting.value >= 15
      ? restSetting.value
      : undefined;

  // Prefill history considers FINISHED workouts only — an in-progress
  // workout must never become its own "last session".
  const allWorkouts = await db.workouts.where({ userId }).toArray();
  const finishedIds = new Set(
    allWorkouts.filter((w) => w.endTs !== undefined).map((w) => w.id),
  );
  const history = (await db.sets.where({ userId }).toArray()).filter((s) =>
    finishedIds.has(s.workoutId),
  );

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
        warmups = warmupRamp(weightKg, 20, warmupStyle(exercise.name));
      }
    } else if (program.mode === "madcow") {
      // The ramp IS the warm-up: each set climbs to the top from the lift's
      // shared top (workingWeightKg) per this row's day role.
      const ramp = rampForRole(
        (pe.madcowRole ?? "heavy") as MadcowRole,
        pe.workingWeightKg ?? 0,
        pe.incrementKg ?? 2.5,
      );
      targets = ramp.map((r) => ({ weightKg: r.weightKg, reps: r.reps, seconds: undefined }));
      warmups = [];
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
      // Explicit per-exercise rest wins; then the user's preferred default
      // (program mode only — routine rests are authored per exercise).
      restSeconds:
        pe.restSeconds ??
        (program.mode === "progression" ? restDefault : undefined) ??
        exercise.restSeconds,
    });
  }

  return { day, mode: program.mode, exercises };
}

/** Create the workout row and return the full session. */
export async function startWorkout(userId: string, dayId: string): Promise<Session> {
  const plan = await buildSessionPlan(userId, dayId);

  // Today's open workout for this day IS this session — adopt it rather than
  // minting a second row. Callers remount (React re-runs the effect, the user
  // navigates back), and without this each remount left an orphan behind:
  // unfinished, so invisible in History, and never cleaned up. Scoped to today
  // so an abandoned session from last week is never resurrected with a stale
  // date.
  const today = new Date().toISOString().slice(0, 10);
  const open = await db.workouts
    .where({ userId })
    .filter(
      (w) => w.programDayId === dayId && w.endTs === undefined && w.date === today,
    )
    .first();
  if (open) return { workout: open, ...plan };

  // Body weight carries forward: the new workout is born with the last
  // recorded weight, so charts stay continuous and the field pre-fills.
  const past = await db.workouts
    .where({ userId })
    .and((w) => w.bodyWeightKg !== undefined)
    .sortBy("startTs");
  const carriedBw = past[past.length - 1]?.bodyWeightKg;

  const workout: Workout = {
    id: newId(),
    userId,
    programDayId: dayId,
    dayLabel: plan.day.name,
    date: new Date().toISOString().slice(0, 10),
    startTs: Date.now(),
    bodyWeightKg: carriedBw,
  };
  await db.workouts.add(workout);
  return { workout, ...plan };
}

/** Alias used by read-only screens. */
export const buildSession = async (userId: string, dayId: string) => {
  const plan = await buildSessionPlan(userId, dayId);
  return plan;
};

/** Everything logged so far for a workout — used to rehydrate UI state on
 * resume and after tab switches. */
export async function loadLoggedSets(workoutId: string): Promise<SetEntry[]> {
  return db.sets.where({ workoutId }).toArray();
}

export interface LoggedValues {
  weightKg?: number;
  reps?: number;
  seconds?: number;
  isWarmup?: boolean;
  note?: string;
  targetReps?: number;
  targetSeconds?: number;
}

/** Upsert one set. Deterministic id makes this atomic and idempotent —
 * concurrent or repeated logs of the same set collapse to one row. */
export async function logSet(
  workoutId: string,
  userId: string,
  exerciseId: string,
  setIndex: number,
  values: LoggedValues,
): Promise<SetEntry> {
  const id = setId(workoutId, exerciseId, setIndex);
  return db.transaction("rw", db.sets, async () => {
    const existing = await db.sets.get(id);
    const entry: SetEntry = {
      id,
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
  });
}

/** Save (or clear, when blank) the free-text note on a workout. */
export async function setWorkoutNote(workoutId: string, notes: string): Promise<void> {
  await db.workouts.update(workoutId, { notes: notes.trim() });
}

/** Remove a set the user un-logged. */
export async function clearSet(
  workoutId: string,
  exerciseId: string,
  setIndex: number,
): Promise<void> {
  await db.sets.delete(setId(workoutId, exerciseId, setIndex));
}

/** Was this session a success for the exercise? Judged over the PRESCRIBED
 * set indexes only — extra back-off sets (index >= pe.sets) don't count
 * against progression. */
function sessionSuccess(sets: SetEntry[], pe: ProgramExercise): boolean {
  const prescribed = sets.filter((s) => !s.isWarmup && s.setIndex < pe.sets);
  return (
    prescribed.length >= pe.sets &&
    prescribed.every((s) => (s.reps ?? 0) >= (pe.targetReps ?? 0))
  );
}

/** The weight this session was worked at = the latest PRESCRIBED work set
 * that carries a weight. Using the latest set (not the max, and never coercing
 * a missing weight to 0) is what keeps assisted (negative) progressions
 * correct: a stale bodyweight/0 stamp — from before assistance was set, or a
 * set logged then the weight changed mid-workout — must not be read as "0kg,"
 * which for an assisted lift is the HARDEST possible set and would silently
 * reset the working weight toward zero (e.g. −10kg → +2.5kg instead of −7.5). */
function sessionWeight(sets: SetEntry[], pe: ProgramExercise): number {
  const weighted = sets
    .filter((s) => !s.isWarmup && s.weightKg !== undefined)
    .sort((a, b) => a.setIndex - b.setIndex);
  const prescribed = weighted.filter((s) => s.setIndex < pe.sets);
  const pick = (prescribed.length ? prescribed : weighted).at(-1);
  return pick?.weightKg ?? pe.workingWeightKg ?? 0;
}

/** Close the workout; in program mode, advance working weights.
 * A workout with zero logged sets is discarded instead — abandoning a
 * screen you opened by accident must not consume the rotation. */
export async function finishWorkout(workoutId: string): Promise<void> {
  const workout = await db.workouts.get(workoutId);
  if (!workout) return;

  const sets = await db.sets.where({ workoutId }).toArray();
  if (sets.filter((s) => !s.isWarmup).length === 0) {
    await db.transaction("rw", [db.workouts, db.sets], async () => {
      await db.sets.where({ workoutId }).delete();
      await db.workouts.delete(workoutId);
    });
    return;
  }

  await db.workouts.update(workoutId, { endTs: Date.now() });
  if (!workout.programDayId) return;

  const day = await db.programDays.get(workout.programDayId);
  const program = day ? await db.programs.get(day.programId) : undefined;
  if (!program) return;
  if (program.mode === "madcow") {
    await advanceMadcowTops(program.id, workout.programDayId, sets);
    return;
  }
  if (program.mode !== "progression") return;

  const pes = await db.programExercises
    .where({ programDayId: workout.programDayId })
    .toArray();

  const linked = program.linkedProgression ?? program.mode === "progression";
  const programDayIds = (
    await db.programDays.where({ programId: program.id }).toArray()
  ).map((d) => d.id);
  const historyDayIds = linked ? programDayIds : [workout.programDayId];

  for (const pe of pes) {
    if (pe.workingWeightKg === undefined || !pe.incrementKg) continue;
    const workSets = sets.filter((s) => s.exerciseId === pe.exerciseId && !s.isWarmup);
    if (workSets.length === 0) continue; // untouched exercise: no change

    const next = nextWorkingWeight(
      {
        incrementKg: pe.incrementKg,
        deloadPct: pe.deloadPct ?? 0.1,
        deloadAfterFails: pe.deloadAfterFails ?? 3,
      },
      await sessionHistory(pe, historyDayIds),
    );
    if (next === undefined) continue;

    const updates: Partial<ProgramExercise> = { workingWeightKg: next };

    // Stall protocol (main 5-rep lifts only): the first deload keeps 5×5;
    // the second drops to 3×5; the third to 1×5.
    if (next < pe.workingWeightKg) {
      const deloadCount = (pe.deloadCount ?? 0) + 1;
      updates.deloadCount = deloadCount;
      if ((pe.targetReps ?? 0) === 5) {
        if (deloadCount >= 3 && pe.sets === 3) updates.sets = 1;
        else if (deloadCount >= 2 && pe.sets === 5) updates.sets = 3;
      }
    }
    await db.programExercises.update(pe.id, updates);

    // Linked progression: one chain per exercise — every slot of this
    // exercise in the program follows the new weight.
    //
    // The PROGRAM decides this, not a per-program preference: StrongLifts
    // trains squat every session across A/B, and that is ONE ladder. Left
    // unlinked, the slots drift into two ladders climbing at half speed, and
    // the lifter hand-syncs them — or logs a junk set to force the one that's
    // behind. Madcow already links unconditionally (advanceMadcowTops). An
    // explicit flag can still opt out.
    if (linked) {
      const siblings = await db.programExercises
        .where("programDayId")
        .anyOf(programDayIds)
        .and((s) => s.exerciseId === pe.exerciseId && s.id !== pe.id)
        .toArray();
      for (const sib of siblings) {
        await db.programExercises.update(sib.id, { workingWeightKg: next });
      }
    }
  }
}

/** Madcow weekly progression: on the finished day, for each lift whose top
 * set advances here, if the top set hit its reps, bump the lift's shared top
 * by its increment and sync every day-row of that lift in the program. */
async function advanceMadcowTops(
  programId: string,
  dayId: string,
  sets: SetEntry[],
): Promise<void> {
  const pes = await db.programExercises.where({ programDayId: dayId }).toArray();
  const dayIds = (await db.programDays.where({ programId }).toArray()).map((d) => d.id);

  for (const pe of pes) {
    if (!pe.madcowProgresses || pe.workingWeightKg === undefined) continue;
    const role = (pe.madcowRole ?? "heavy") as MadcowRole;
    const idx = topSetIndex(role);
    if (idx < 0) continue;

    const increment = pe.incrementKg ?? 2.5;
    const ramp = rampForRole(role, pe.workingWeightKg, increment);
    const topReps = ramp[idx]?.reps ?? 5;
    const topSet = sets.find(
      (s) => s.exerciseId === pe.exerciseId && !s.isWarmup && s.setIndex === idx,
    );
    const hit = (topSet?.reps ?? 0) >= topReps;
    const newTop = nextTop(pe.workingWeightKg, increment, hit);
    if (newTop === pe.workingWeightKg) continue;

    const rows = await db.programExercises
      .where("programDayId")
      .anyOf(dayIds)
      .and((r) => r.exerciseId === pe.exerciseId)
      .toArray();
    for (const row of rows) {
      await db.programExercises.update(row.id, { workingWeightKg: newTop });
    }
  }
}

/** Success/fail history for an exercise ON ITS PROGRAM DAY, oldest first.
 * Scoping to the day matters: squat on day A and day B are separate
 * progressions, and mixing them would reset fail streaks every session.
 * Each session's weight is its top work-set weight. */
async function sessionHistory(
  pe: ProgramExercise,
  programDayIds: string[],
): Promise<{ weightKg: number; success: boolean }[]> {
  // One day for a per-slot ladder; every day of the program for a linked one.
  // These must agree with how the weight is written: reading one day's history
  // while linking writes across days makes the computed next weight disagree
  // with the stored one, and the deload check (next < workingWeightKg) fires
  // on lifts that never failed.
  const dayWorkouts = await db.workouts
    .where("programDayId")
    .anyOf(programDayIds)
    .toArray();
  const workoutTs = new Map(dayWorkouts.map((w) => [w.id, w.startTs ?? 0]));

  const all = await db.sets
    .where("exerciseId")
    .equals(pe.exerciseId)
    .toArray()
    .catch(() => [] as SetEntry[]);

  const byWorkout = new Map<string, SetEntry[]>();
  for (const s of all) {
    if (s.isWarmup || !workoutTs.has(s.workoutId)) continue;
    const list = byWorkout.get(s.workoutId) ?? [];
    list.push(s);
    byWorkout.set(s.workoutId, list);
  }

  const sessions: { weightKg: number; success: boolean; ts: number }[] = [];
  for (const [workoutId, workoutSets] of byWorkout.entries()) {
    sessions.push({
      weightKg: sessionWeight(workoutSets, pe),
      success: sessionSuccess(workoutSets, pe),
      ts: workoutTs.get(workoutId) ?? 0,
    });
  }
  sessions.sort((a, b) => a.ts - b.ts);
  return sessions.map(({ weightKg, success }) => ({ weightKg, success }));
}
