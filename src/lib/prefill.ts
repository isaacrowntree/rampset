/** Routine-mode prefill: each set proposes last session's numbers. */

import type { SetEntry } from "./types";

export interface SetPrefill {
  weightKg?: number;
  reps?: number;
  seconds?: number;
}

/**
 * Build per-set prefills for an exercise from its set history.
 * Uses only the most recent workout containing the exercise; pads extra
 * planned sets with the last known set's values; empty when never done.
 */
export function prefillFromLastSession(
  history: SetEntry[],
  exerciseId: string,
  plannedSets: number,
): SetPrefill[] {
  const workSets = history.filter(
    (s) => s.exerciseId === exerciseId && !s.isWarmup && s.completedTs !== undefined,
  );
  if (workSets.length === 0) {
    return Array.from({ length: plannedSets }, () => ({}));
  }

  // Most recent workout = the one containing the newest completed set.
  const newest = workSets.reduce((a, b) =>
    (a.completedTs ?? 0) >= (b.completedTs ?? 0) ? a : b,
  );
  const lastSession = workSets
    .filter((s) => s.workoutId === newest.workoutId)
    .sort((a, b) => a.setIndex - b.setIndex);

  const toPrefill = (s: SetEntry): SetPrefill => {
    const p: SetPrefill = {};
    if (s.weightKg !== undefined && s.weightKg !== 0) p.weightKg = s.weightKg;
    if (s.reps !== undefined && s.reps > 0) p.reps = s.reps;
    if (s.seconds !== undefined && s.seconds > 0) p.seconds = s.seconds;
    return p;
  };

  const prefills = lastSession.map(toPrefill);
  while (prefills.length < plannedSets) {
    prefills.push({ ...prefills[prefills.length - 1] });
  }
  return prefills.slice(0, plannedSets);
}
