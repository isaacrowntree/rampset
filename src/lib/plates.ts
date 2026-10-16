/** Plate math + StrongLifts-style warmup ramps. */

/** Pairs available per side, descending. Most gyms stock 25s, so they're
 * in by default; Settings can take them out for a gym that tops out at 20. */
export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
export const PLATES_WITHOUT_25 = [20, 15, 10, 5, 2.5, 1.25];

/** IWF plate color per kg denomination — CSS vars, so each skin can tune
 * the hue (Apple's system colors differ slightly between dark and light). */
export const PLATE_COLORS: Record<number, string> = {
  25: "var(--plate-25)",
  20: "var(--plate-20)",
  15: "var(--plate-15)",
  10: "var(--plate-10)",
  5: "var(--plate-5)",
  2.5: "var(--plate-25)",
  1.25: "#636366", // graphite: must read apart from the steel collar
};

/** Legible label color on each plate's fill. */
const PLATE_INK: Record<number, string> = {
  25: "#ffffff",
  20: "#ffffff",
  15: "#000000",
  10: "#000000",
  5: "#000000",
  2.5: "#ffffff",
  1.25: "#000000",
};

/** Bare-bar steel, for a set with no plates on. */
const BAR_STEEL = { fill: "#8e8e93", ink: "#000000" };

/** The color a set at this weight wears: its heaviest plate, the way a
 * loaded bar reads from across the gym. Null when the weight isn't barbell
 * territory (bodyweight, dumbbells, assistance) — callers fall back to the
 * user's accent. */
export function loadColor(
  totalKg: number | undefined,
  barKg = 20,
  available: number[] = DEFAULT_PLATES,
): { fill: string; ink: string } | null {
  if (totalKg === undefined || totalKg < barKg) return null;
  const plates = platesPerSide(totalKg, barKg, available);
  if (plates === null) return null;
  const top = plates[0];
  // Bare bar, or only change plates on it: from across the gym that's steel.
  // (A small red 2.5 must not read as a red 25.)
  if (top === undefined || top < 5) return BAR_STEEL;
  return { fill: PLATE_COLORS[top], ink: PLATE_INK[top] };
}

/**
 * Greedy per-side plate breakdown. Returns null when not exactly loadable.
 */
export function platesPerSide(
  totalKg: number,
  barKg: number,
  available: number[] = DEFAULT_PLATES,
): number[] | null {
  let perSide = (totalKg - barKg) / 2;
  if (perSide < 0) return null;
  const result: number[] = [];
  for (const plate of [...available].sort((a, b) => b - a)) {
    while (perSide >= plate - 1e-9) {
      result.push(plate);
      perSide -= plate;
    }
  }
  return Math.abs(perSide) < 1e-9 ? result : null;
}

export interface WarmupSet {
  reps: number;
  weightKg: number;
}

export type WarmupStyle = "bar" | "floor";

/**
 * StrongLifts warmup protocol (per stronglifts.com):
 * - Bar lifts (squat/bench/OHP): 2×5 with the empty bar, then heavier sets
 *   up to the work weight. Nothing to do within 5kg of the bar.
 * - Floor pulls (deadlift/row): no empty bar — the plates must rest on the
 *   floor, so start around half the work weight (min 40kg) and ramp.
 *   Light floor pulls skip warmups entirely ("don't bother").
 * Ramp steps run 5/5/3/2 reps at ½, ⅔, ⅚, 11⁄12 of the work weight.
 *
 * Warmup loads land on 10kg totals (5kg a side) so each step is a plate or
 * two, not a stack of change: 42.5kg is 10+1.25 a side mid-warmup, 40kg is
 * just a 10. Where that lands on the step below or the work weight itself,
 * a 5kg total (2.5 a side) is the fallback; failing both, the step is skipped.
 */
export function warmupRamp(
  workKg: number,
  barKg: number,
  style: WarmupStyle = "bar",
): WarmupSet[] {
  const roundTo = (w: number, step: number) => Math.round(w / step) * step;
  const fractions: Array<[number, number]> = [
    [1 / 2, 5],
    [2 / 3, 5],
    [5 / 6, 3],
    [11 / 12, 2],
  ];
  /** The roundest load near `target` that sits strictly between `floor`
   * and the work weight, or null when none does. */
  const pick = (target: number, floor: number): number | null => {
    for (const step of [10, 5]) {
      const w = roundTo(target, step);
      if (w > floor && w < workKg) return w;
    }
    return null;
  };

  if (style === "floor") {
    const start = Math.max(40, roundTo(workKg / 2, 10));
    if (workKg <= start) return [];
    const ramp: WarmupSet[] = [];
    for (const [f, reps] of fractions) {
      const prev = ramp.at(-1)?.weightKg;
      const w = prev === undefined ? start : pick(workKg * f, prev);
      if (w === null || w >= workKg) continue;
      ramp.push({ reps, weightKg: w });
    }
    return ramp;
  }

  // Bar lift
  if (workKg <= barKg + 5) return [];
  const barSets: WarmupSet[] = [
    { reps: 5, weightKg: barKg },
    { reps: 5, weightKg: barKg },
  ];
  if (workKg - barKg <= 25) {
    const mid = pick((barKg + workKg) / 2, barKg);
    return mid === null ? barSets : [...barSets, { reps: 3, weightKg: mid }];
  }
  const ramp: WarmupSet[] = [...barSets];
  for (const [f, reps] of fractions) {
    const w = pick(workKg * f, Math.max(barKg + 5, ramp[ramp.length - 1].weightKg));
    if (w === null) continue;
    ramp.push({ reps, weightKg: w });
  }
  return ramp;
}
