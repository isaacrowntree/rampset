/** Core domain types shared by engines, store, and UI. */

export type ProgramMode = "progression" | "routine";
export type ExerciseKind = "weighted" | "bodyweight" | "timed";
export type Unit = "kg" | "lb";

export interface User {
  id: string;
  email: string;
  name: string;
  /** IWF plate color key used as the user's accent. */
  accent: "blue" | "green";
  unit: Unit;
}

export interface Exercise {
  id: string;
  userId: string;
  name: string;
  kind: ExerciseKind;
  /** Default rest between sets, seconds. */
  restSeconds: number;
  /** Pinned note shown during workouts. */
  note?: string;
}

export interface Program {
  id: string;
  userId: string;
  name: string;
  mode: ProgramMode;
}

export interface ProgramDay {
  id: string;
  programId: string;
  position: number;
  name: string;
}

export interface ProgramExercise {
  id: string;
  programDayId: string;
  exerciseId: string;
  position: number;
  sets: number;
  /** Target reps for rep-based sets. */
  targetReps?: number;
  /** Target seconds for timed sets. */
  targetSeconds?: number;
  /** Progression mode only: kg added per successful workout. */
  incrementKg?: number;
  /** Progression mode only: fraction to deload after repeated fails (e.g. 0.1). */
  deloadPct?: number;
  /** Progression mode only: fails before a deload triggers. */
  deloadAfterFails?: number;
  /** Overrides the exercise default rest. */
  restSeconds?: number;
  /** Progression mode: current working weight. */
  workingWeightKg?: number;
}

export interface Workout {
  id: string;
  userId: string;
  programDayId?: string;
  dayLabel: string;
  date: string; // yyyy-mm-dd
  bodyWeightKg?: number;
  startTs?: number;
  endTs?: number;
  notes?: string;
}

export interface SetEntry {
  id: string;
  workoutId: string;
  userId: string;
  exerciseId: string;
  setIndex: number;
  targetReps?: number;
  targetSeconds?: number;
  reps?: number;
  seconds?: number;
  weightKg?: number;
  isWarmup: boolean;
  note?: string;
  completedTs?: number;
}
