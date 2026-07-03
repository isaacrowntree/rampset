/** StrongLifts export dialect: wide CSV, one row per exercise per workout,
 * sets in `Set N (Reps)` / `Set N (KG)` column pairs. */

import { parseCsvWithHeader } from "./csv";
import type { ImportResult, ImportedWorkout, ImportedSet } from "./types";

export function parseStrongLiftsCsv(text: string): ImportResult {
  const rows = parseCsvWithHeader(text);
  const byWorkout = new Map<string, ImportedWorkout>();

  for (const row of rows) {
    const num = row["Workout"];
    const date = (row["Date (yyyy/mm/dd)"] ?? "").replaceAll("/", "-");
    if (!num || !date) continue;
    const key = `${date}#${num}`;

    let workout = byWorkout.get(key);
    if (!workout) {
      workout = {
        date,
        dayLabel: row["Workout Name"] || "Workout",
        bodyWeightKg: parseNum(row["Body Weight (KG)"]),
        notes: row["Notes"]?.trim() || undefined,
        durationMinutes: durationToMinutes(row["Duration (hours)"]),
        exercises: [],
      };
      byWorkout.set(key, workout);
    }

    const sets: ImportedSet[] = [];
    for (let n = 1; n <= 5; n++) {
      const reps = parseNum(row[`Set ${n} (Reps)`]);
      const weight = parseNum(row[`Set ${n} (KG)`]);
      if (reps === undefined) continue;
      sets.push({ reps, weightKg: weight ?? 0 });
    }
    if (sets.length > 0) {
      workout.exercises.push({
        name: (row["Exercise"] ?? "").trim(),
        kind: "weighted",
        sets,
      });
    }
  }

  return { workouts: [...byWorkout.values()] };
}

function parseNum(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function durationToMinutes(v: string | undefined): number | undefined {
  const h = parseNum(v);
  if (h === undefined) return undefined;
  return Math.round(h * 60);
}
