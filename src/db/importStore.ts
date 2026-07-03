"use client";

/** Write an ImportResult into the store: match exercises by normalized name,
 * create missing ones, idempotent on (date + dayLabel + startTs ordinal). */

import { db, newId } from "./db";
import type { ImportResult } from "@/lib/importers/types";
import type { Exercise, SetEntry, Workout } from "@/lib/types";

export interface ImportSummary {
  workoutsAdded: number;
  workoutsSkipped: number;
  setsAdded: number;
  exercisesCreated: string[];
}

export async function importIntoStore(
  userId: string,
  result: ImportResult,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    workoutsAdded: 0,
    workoutsSkipped: 0,
    setsAdded: 0,
    exercisesCreated: [],
  };

  const existing = await db.exercises.where({ userId }).toArray();
  const byName = new Map(existing.map((e) => [e.name.toLowerCase(), e]));

  const existingWorkouts = await db.workouts.where({ userId }).toArray();
  const seen = new Set(existingWorkouts.map((w) => `${w.date}#${w.dayLabel}#${w.startTs ?? ""}`));
  const seenLoose = new Set(existingWorkouts.map((w) => `${w.date}#${w.dayLabel}`));

  const workouts: Workout[] = [];
  const sets: SetEntry[] = [];
  const newExercises: Exercise[] = [];

  // Imports are historical: synthesize stable timestamps from the date so
  // ordering and "last session" prefills work.
  for (const [i, iw] of result.workouts.entries()) {
    const looseKey = `${iw.date}#${iw.dayLabel}`;
    if (seenLoose.has(looseKey)) {
      summary.workoutsSkipped++;
      continue;
    }
    seenLoose.add(looseKey);

    const baseTs = Date.parse(`${iw.date}T06:00:00Z`) + (i % 10) * 60_000;
    const workout: Workout = {
      id: newId(),
      userId,
      dayLabel: iw.dayLabel,
      date: iw.date,
      bodyWeightKg: iw.bodyWeightKg,
      notes: iw.notes,
      startTs: baseTs,
      endTs: baseTs + (iw.durationMinutes ?? 45) * 60_000,
    };
    workouts.push(workout);
    summary.workoutsAdded++;

    for (const ie of iw.exercises) {
      const key = ie.name.toLowerCase();
      let exercise = byName.get(key);
      if (!exercise) {
        exercise = {
          id: newId(),
          userId,
          name: ie.name,
          kind: ie.kind,
          restSeconds: ie.restSeconds ?? 90,
        };
        byName.set(key, exercise);
        newExercises.push(exercise);
        summary.exercisesCreated.push(ie.name);
      }

      ie.sets.forEach((s, idx) => {
        sets.push({
          id: newId(),
          workoutId: workout.id,
          userId,
          exerciseId: exercise!.id,
          setIndex: idx,
          weightKg: s.weightKg,
          reps: s.reps,
          seconds: s.seconds,
          isWarmup: false,
          note: s.note,
          completedTs: baseTs + idx * 90_000,
        });
        summary.setsAdded++;
      });
    }
  }

  await db.transaction("rw", [db.workouts, db.sets, db.exercises], async () => {
    if (newExercises.length) await db.exercises.bulkAdd(newExercises);
    if (workouts.length) await db.workouts.bulkAdd(workouts);
    if (sets.length) await db.sets.bulkAdd(sets);
  });

  return summary;
}
