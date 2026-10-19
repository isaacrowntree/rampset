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

  // Idempotency: several genuinely distinct workouts can share a date AND a
  // day label (two "Workout A"s in one day is common in real exports), so
  // dedupe by SEQUENCE within each (date, label) group: if this device
  // already has N workouts for the group, the import's first N are treated
  // as duplicates and any beyond that are added.
  const existingWorkouts = await db.workouts.where({ userId }).toArray();
  const existingCount = new Map<string, number>();
  for (const w of existingWorkouts) {
    const key = `${w.date}#${w.dayLabel}`;
    existingCount.set(key, (existingCount.get(key) ?? 0) + 1);
  }
  const importSeq = new Map<string, number>();

  const workouts: Workout[] = [];
  const sets: SetEntry[] = [];
  const newExercises: Exercise[] = [];

  // Imports are historical: synthesize stable timestamps from the date so
  // ordering and "last session" prefills work. Same-day workouts are spaced
  // by their sequence in the export (chronological).
  for (const iw of result.workouts) {
    const key = `${iw.date}#${iw.dayLabel}`;
    const seq = importSeq.get(key) ?? 0;
    importSeq.set(key, seq + 1);
    if (seq < (existingCount.get(key) ?? 0)) {
      summary.workoutsSkipped++;
      continue;
    }

    const baseTs = Date.parse(`${iw.date}T06:00:00Z`) + seq * 2 * 3600_000;
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
