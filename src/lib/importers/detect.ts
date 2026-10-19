/** Which app a CSV came from, read off its header row. */

import { parseStrongCsv } from "./strong";
import { parseStrongLiftsCsv } from "./stronglifts";
import type { ImportResult } from "./types";

export interface DetectedExport {
  source: "StrongLifts" | "Strong";
  result: ImportResult;
}

/** Null when the file is neither app's export, or has no workouts in it. */
export function parseExport(text: string): DetectedExport | null {
  const header = text.slice(0, 400);
  const detected: DetectedExport | null = header.includes("Set Order")
    ? { source: "Strong", result: parseStrongCsv(text) }
    : header.includes("Date (yyyy/mm/dd)") || header.includes("Workout,Workout Name")
      ? { source: "StrongLifts", result: parseStrongLiftsCsv(text) }
      : null;
  return detected && detected.result.workouts.length > 0 ? detected : null;
}
