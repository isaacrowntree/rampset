/** Selectable program templates (the StrongLifts family + the routine).
 *
 * A template is a pure description of days/exercises/sets/reps/starting
 * weights. It is turned into real program/day/programExercise rows by
 * buildProgramFromTemplate (see programSwitch.ts). Exercises are referenced
 * by name and resolve to a STABLE deterministic id, so switching templates
 * reuses existing exercises and keeps all workout history linked. */

import type { ExerciseKind, ProgramMode } from "./types";

/** Same slug rule the seed uses — keep in lockstep so ids match. */
export function slugName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export interface TemplateExercise {
  name: string;
  kind: ExerciseKind;
  sets: number;
  reps?: number;
  seconds?: number;
  /** Weighted only: starting working weight (kg). */
  startKg?: number;
  /** Per-success increment. Default 2.5 for weighted; 0 = no auto progression.
   * Madcow: the WEEKLY top-set increment. */
  incrementKg?: number;
  restSeconds?: number;
  /** Madcow: this row's day role (drives the ramp). */
  madcowRole?: "heavy" | "light" | "intensity";
  /** Madcow: the top set on this row advances the lift's shared top. */
  madcowProgresses?: boolean;
}

export interface TemplateDay {
  /** Stable id fragment (e.g. "a", "u1") — keeps day ids deterministic. */
  key: string;
  name: string;
  exercises: TemplateExercise[];
}

export interface ProgramTemplate {
  /** Registry key and the value stored on Program.templateId. */
  id: string;
  name: string;
  mode: ProgramMode;
  blurb: string;
  days: TemplateDay[];
}

// ---- concise builders --------------------------------------------------
const lift = (
  name: string,
  sets: number,
  reps: number,
  startKg: number,
  extra: Partial<TemplateExercise> = {},
): TemplateExercise => ({ name, kind: "weighted", sets, reps, startKg, ...extra });

/** Weighted accessory that can also be run assisted/bodyweight (starts at 0). */
const acc = (name: string, sets: number, reps: number, startKg = 0): TemplateExercise =>
  ({ name, kind: "weighted", sets, reps, startKg });

const bw = (name: string, sets: number, reps: number): TemplateExercise =>
  ({ name, kind: "bodyweight", sets, reps, incrementKg: 0 });

const timed = (name: string, sets: number, seconds: number): TemplateExercise =>
  ({ name, kind: "timed", sets, seconds, incrementKg: 0 });

/** Deadlift: +5kg/session, floor pulls rest longer. */
const dl = (sets: number, startKg = 40): TemplateExercise =>
  lift("Deadlift", sets, 5, startKg, { incrementKg: 5, restSeconds: 180 });

/** Madcow lift: a ramped row of the given day role. `sets` tracks the ramp
 * length (heavy 5, light 3, intensity 6); the actual per-set weights/reps come
 * from the ramp engine. `startKg` is the shared top; `incrementKg` is weekly. */
const mc = (
  name: string,
  role: "heavy" | "light" | "intensity",
  progresses: boolean,
  startKg: number,
  incrementKg: number,
): TemplateExercise => ({
  name,
  kind: "weighted",
  sets: role === "light" ? 3 : role === "intensity" ? 6 : 5,
  reps: 5,
  startKg,
  incrementKg,
  restSeconds: 180,
  madcowRole: role,
  madcowProgresses: progresses,
});

// ---- the registry ------------------------------------------------------
// Structures mirror the official StrongLifts program pages. Optional
// assistance work is omitted — add it per exercise in the editor.
export const PROGRAM_TEMPLATES: ProgramTemplate[] = [
  {
    id: "5x5",
    name: "StrongLifts 5×5",
    mode: "progression",
    blurb: "The original. Squat every session, alternating Workout A/B.",
    days: [
      {
        key: "a",
        name: "Workout A",
        exercises: [
          lift("Squat", 5, 5, 20),
          lift("Bench press", 5, 5, 20),
          lift("Barbell row", 5, 5, 30),
        ],
      },
      {
        key: "b",
        name: "Workout B",
        exercises: [
          lift("Squat", 5, 5, 20),
          lift("Overhead press", 5, 5, 20),
          dl(1),
        ],
      },
    ],
  },
  {
    id: "plus",
    name: "StrongLifts 5×5 Plus",
    mode: "progression",
    blurb: "3-day split: squat/deadlift 1×/week, ~80% of volume upper body.",
    days: [
      {
        key: "a",
        name: "Workout A",
        exercises: [
          lift("Squat", 5, 5, 20),
          lift("Bench press", 5, 5, 20),
          lift("Barbell row", 5, 5, 30),
          bw("Sit ups", 3, 8),
        ],
      },
      {
        key: "b",
        name: "Workout B",
        exercises: [
          dl(5),
          lift("Overhead press", 5, 5, 20),
          acc("Dips", 5, 5),
          timed("Plank", 3, 30),
        ],
      },
      {
        key: "c",
        name: "Workout C",
        exercises: [
          lift("Incline bench press", 3, 8, 20),
          acc("Pullups", 3, 8),
          acc("Dumbbell bench press", 3, 8, 10),
          acc("Dumbbell row", 3, 8, 10),
          acc("Skullcrushers", 3, 8, 10),
          acc("Barbell curl", 3, 8, 10),
          acc("Calf raise", 3, 8),
          acc("Pallof press", 3, 8),
        ],
      },
    ],
  },
  {
    id: "ultra",
    name: "StrongLifts 5×5 Ultra",
    mode: "progression",
    blurb: "4-day upper/lower split (Mon/Tue/Thu/Fri).",
    days: [
      {
        key: "a",
        name: "Workout A · Lower",
        exercises: [lift("Squat", 5, 5, 20), dl(1)],
      },
      {
        key: "b",
        name: "Workout B · Upper",
        exercises: [lift("Bench press", 5, 5, 20), lift("Barbell row", 5, 5, 30)],
      },
      {
        key: "c",
        name: "Workout C · Lower",
        exercises: [dl(5), lift("Squat", 1, 5, 20)],
      },
      {
        key: "d",
        name: "Workout D · Upper",
        exercises: [lift("Overhead press", 5, 5, 20), lift("Bench press", 5, 5, 20)],
      },
    ],
  },
  {
    id: "ultra-max",
    name: "StrongLifts 5×5 Ultra Max",
    mode: "progression",
    blurb: "5-day upper/lower with three upper-body days.",
    days: [
      {
        key: "a",
        name: "Workout A · Lower",
        exercises: [lift("Squat", 5, 5, 20), dl(1)],
      },
      {
        key: "b",
        name: "Workout B · Upper",
        exercises: [
          lift("Bench press", 5, 5, 20),
          lift("Barbell row", 5, 5, 30),
          acc("Dumbbell bench press", 3, 8, 10),
        ],
      },
      {
        key: "c",
        name: "Workout C · Lower",
        exercises: [dl(5), lift("Squat", 1, 5, 20)],
      },
      {
        key: "d",
        name: "Workout D · Upper",
        exercises: [
          lift("Incline bench press", 5, 5, 20),
          acc("Dips", 5, 5),
          acc("Dumbbell row", 3, 8, 10),
        ],
      },
      {
        key: "e",
        name: "Workout E · Upper",
        exercises: [
          lift("Overhead press", 5, 5, 20),
          acc("Chinups", 5, 5),
          acc("Barbell curl", 3, 8, 10),
        ],
      },
    ],
  },
  {
    id: "lite",
    name: "StrongLifts 5×5 Lite",
    mode: "progression",
    blurb: "Lower volume (2×5) for recovery-limited lifters.",
    days: [
      {
        key: "a",
        name: "Workout A",
        exercises: [
          lift("Squat", 2, 5, 20),
          lift("Bench press", 2, 5, 20),
          lift("Barbell row", 2, 5, 30),
        ],
      },
      {
        key: "b",
        name: "Workout B",
        exercises: [
          lift("Squat", 2, 5, 20),
          lift("Overhead press", 2, 5, 20),
          dl(2),
        ],
      },
    ],
  },
  {
    id: "mini",
    name: "StrongLifts 5×5 Mini",
    mode: "progression",
    blurb: "Minimalist maintenance — the big four, least gym time.",
    days: [
      {
        key: "a",
        name: "Workout A",
        exercises: [lift("Squat", 2, 5, 20), lift("Bench press", 2, 5, 20)],
      },
      {
        key: "b",
        name: "Workout B",
        exercises: [dl(2), lift("Overhead press", 2, 5, 20)],
      },
    ],
  },
  {
    id: "intermediate",
    name: "StrongLifts 5×5 Intermediate",
    mode: "progression",
    blurb: "Squat 2×/week, Bench 3×/week — for when linear stalls.",
    days: [
      {
        key: "a",
        name: "Workout A",
        exercises: [
          lift("Squat", 5, 5, 20),
          lift("Bench press", 5, 5, 20),
          lift("Barbell row", 5, 8, 30),
        ],
      },
      {
        key: "b",
        name: "Workout B",
        exercises: [
          dl(5),
          lift("Incline bench press", 5, 8, 20),
          lift("Bench press feet up", 5, 8, 20),
        ],
      },
      {
        key: "c",
        name: "Workout C · Pause lifts",
        exercises: [
          lift("Pause squat", 5, 3, 20),
          lift("Pause bench", 5, 3, 20),
          lift("Pause deadlift", 2, 3, 40, { restSeconds: 180 }),
        ],
      },
    ],
  },
  {
    id: "madcow",
    name: "Madcow 5×5",
    mode: "madcow",
    blurb:
      "Intermediate weekly progression: ramped 5×5, a light mid-week, and a Friday PR set that sets next week's top.",
    days: [
      {
        key: "mon",
        name: "Monday · Volume",
        exercises: [
          mc("Squat", "heavy", false, 60, 2.5),
          mc("Bench press", "heavy", false, 40, 1.25),
          mc("Barbell row", "heavy", false, 40, 1.25),
        ],
      },
      {
        key: "wed",
        name: "Wednesday · Light",
        exercises: [
          mc("Squat", "light", false, 60, 2.5),
          mc("Overhead press", "heavy", true, 30, 1.25),
          mc("Deadlift", "heavy", true, 80, 2.5),
        ],
      },
      {
        key: "fri",
        name: "Friday · Intensity",
        exercises: [
          mc("Squat", "intensity", true, 60, 2.5),
          mc("Bench press", "intensity", true, 40, 1.25),
          mc("Barbell row", "intensity", true, 40, 1.25),
        ],
      },
    ],
  },
  // Free-form: no prescription and no progression engine. It starts as one
  // empty day — the lifter builds days and exercises in the Program tab, and
  // every set prefills from their last workout. The id matches the routine
  // programs seeded before templates existed, so those read as this one.
  {
    id: "routine",
    name: "Custom routine",
    mode: "routine",
    blurb: "Build your own days and exercises. No automatic progression — every set prefills from your last workout.",
    days: [{ key: "1", name: "Day 1", exercises: [] }],
  },
];

export function getTemplate(id: string): ProgramTemplate | undefined {
  return PROGRAM_TEMPLATES.find((t) => t.id === id);
}
