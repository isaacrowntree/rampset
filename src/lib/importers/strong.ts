/** Strong export dialect: long CSV, one row per set, interleaved
 * "Rest Timer" rows, timed/bodyweight/weighted kinds, per-set notes. */

import { parseCsvWithHeader } from "./csv";
import type { ExerciseKind } from "../types";
import type { ImportResult, ImportedWorkout, ImportedExercise } from "./types";

/** Trim, collapse whitespace, sentence-case (keep parenthetical casing). */
export function normalizeExerciseName(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed === "") return collapsed;
  // Lowercase words after the first, but leave parenthesized qualifiers alone.
  const [head, ...rest] = collapsed.split(" ");
  const tail = rest.map((w) => (w.startsWith("(") ? w : w.toLowerCase()));
  const headCased = head[0].toUpperCase() + head.slice(1);
  return [headCased, ...tail].join(" ");
}

export function parseStrongCsv(text: string): ImportResult {
  const rows = parseCsvWithHeader(text);
  const byWorkout = new Map<string, ImportedWorkout>();
  const exByWorkout = new Map<string, Map<string, ImportedExercise>>();

  for (const row of rows) {
    const ts = row["Date"];
    if (!ts) continue;
    const date = ts.slice(0, 10);

    let workout = byWorkout.get(ts);
    if (!workout) {
      workout = {
        date,
        dayLabel: (row["Workout Name"] ?? "").trim() || "Workout",
        durationMinutes: parseDuration(row["Duration"]),
        exercises: [],
      };
      byWorkout.set(ts, workout);
      exByWorkout.set(ts, new Map());
    }

    const name = normalizeExerciseName(row["Exercise Name"] ?? "");
    if (!name) continue;
    const exMap = exByWorkout.get(ts)!;
    let ex = exMap.get(name);
    if (!ex) {
      ex = { name, kind: "bodyweight", sets: [] };
      exMap.set(name, ex);
      workout.exercises.push(ex);
    }

    if (row["Set Order"] === "Rest Timer") {
      const rest = num(row["Seconds"]);
      if (rest && rest > 5) ex.restSeconds = rest;
      continue;
    }
    if (row["Set Order"] === "Note") continue;

    const weight = num(row["Weight"]) ?? 0;
    const reps = num(row["Reps"]) ?? 0;
    const seconds = num(row["Seconds"]) ?? 0;
    const note = (row["Notes"] ?? "").trim();

    const set: { weightKg?: number; reps?: number; seconds?: number; note?: string } = {};
    let kind: ExerciseKind;
    if (seconds > 0 && reps === 0 && weight === 0) {
      kind = "timed";
      set.seconds = seconds;
    } else if (weight !== 0) {
      kind = "weighted";
      set.weightKg = weight;
      if (reps > 0) set.reps = reps;
    } else {
      kind = "bodyweight";
      if (reps > 0) set.reps = reps;
    }
    if (note && note !== "\\n") set.note = note;

    // Upgrade kind: any weighted set makes the exercise weighted; timed wins over bodyweight.
    if (ex.sets.length === 0) ex.kind = kind;
    else if (kind === "weighted") ex.kind = "weighted";
    else if (kind === "timed" && ex.kind === "bodyweight") ex.kind = "timed";

    ex.sets.push(set);
  }

  // Drop workouts that ended up with no real sets (all rest-timer rows).
  const workouts = [...byWorkout.values()].filter((w) =>
    w.exercises.some((e) => e.sets.length > 0),
  );
  for (const w of workouts) {
    w.exercises = w.exercises.filter((e) => e.sets.length > 0);
  }
  return { workouts };
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** "38m", "2h 34m", "62h 43m" → minutes, capped at 4h (Strong leaves workouts open). */
function parseDuration(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const h = /(\d+)h/.exec(v);
  const m = /(\d+)m/.exec(v);
  const minutes = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
  if (minutes === 0) return undefined;
  return Math.min(minutes, 240);
}
