import type { ExerciseKind } from "../types";

/** Importer output — dialect-agnostic, ready for the store. */
export interface ImportedSet {
  weightKg?: number;
  reps?: number;
  seconds?: number;
  note?: string;
}

export interface ImportedExercise {
  name: string;
  kind: ExerciseKind;
  restSeconds?: number;
  sets: ImportedSet[];
}

export interface ImportedWorkout {
  date: string; // yyyy-mm-dd
  dayLabel: string;
  bodyWeightKg?: number;
  notes?: string;
  durationMinutes?: number;
  exercises: ImportedExercise[];
}

export interface ImportResult {
  workouts: ImportedWorkout[];
}
