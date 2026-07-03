/** Linear progression engine (program mode). Pure functions, unit-tested. */

export interface ProgressionRule {
  incrementKg: number;
  /** Fraction removed on deload, e.g. 0.1. */
  deloadPct: number;
  /** Consecutive fails at the same weight before deloading. */
  deloadAfterFails: number;
}

export interface SessionResult {
  weightKg: number;
  /** True when every work set hit its target reps. */
  success: boolean;
}

/** Round down to the nearest loadable step (2.5kg by default). */
export function roundToIncrement(weightKg: number, step: number): number {
  return Math.floor(weightKg / step + 1e-9) * step;
}

/**
 * Compute the next working weight from session history (oldest → newest).
 * - success → last weight + increment
 * - fail → repeat weight
 * - deloadAfterFails consecutive fails at the same weight → deload by deloadPct
 */
export function nextWorkingWeight(
  rule: ProgressionRule,
  history: SessionResult[],
): number | undefined {
  if (history.length === 0) return undefined;
  const last = history[history.length - 1];

  if (last.success) return last.weightKg + rule.incrementKg;

  // Count consecutive fails at the current weight, ending at the last session.
  let fails = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const s = history[i];
    if (!s.success && s.weightKg === last.weightKg) fails++;
    else break;
  }

  if (fails >= rule.deloadAfterFails) {
    return roundToIncrement(last.weightKg * (1 - rule.deloadPct), 2.5);
  }
  return last.weightKg;
}
