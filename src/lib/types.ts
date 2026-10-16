/** Core domain types shared by engines, store, and UI. */

export type ProgramMode = "progression" | "routine" | "madcow";
export type ExerciseKind = "weighted" | "bodyweight" | "timed";
export type Unit = "kg" | "lb";
export type Theme = "dark" | "light";

export interface User {
  id: string;
  email: string;
  name: string;
  /** IWF plate color key used as the user's accent. */
  accent: "blue" | "green";
  unit: Unit;
  /** Per-user skin. Defaults to dark; the Strong-style routine variant
   * defaults to light. */
  theme?: Theme;
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
  /** Which template this program was built from (drives the picker's active
   * state). Absent on legacy programs seeded before templates existed. */
  templateId?: string;
  /** Written-5×5 purity: a success advances EVERY slot of that exercise
   * across days (one squat chain). Off by default — per-slot chains. */
  linkedProgression?: boolean;
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
  /** Progression mode: current working weight. Madcow: the shared top set,
   * kept in sync across the lift's day-rows. */
  workingWeightKg?: number;
  /** Progression mode: deloads taken on this slot (drives 5×5→3×5→1×5). */
  deloadCount?: number;
  /** Madcow: which day role this row plays (drives the ramp). */
  madcowRole?: "heavy" | "light" | "intensity";
  /** Madcow: this row's top set advances the lift's shared top on finish. */
  madcowProgresses?: boolean;
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
  /** exerciseId → work sets the program prescribed when this workout
   * started. Progression judges the session against this, so lowering Sets
   * mid-workout (which rewrites the program) can't turn skipped sets into a
   * success. Absent on workouts from before it was recorded. */
  prescribedSets?: Record<string, number>;
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
