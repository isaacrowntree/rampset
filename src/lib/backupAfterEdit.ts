"use client";

/** Keep the cloud snapshot fresh after edits that the finished-workout sync
 * path doesn't carry — program structure (add/remove/sets/reps/weight) and
 * corrections to past sets. Without this, those edits only reach a new
 * device if a workout is finished afterwards.
 *
 * Debounced so a burst of stepper taps coalesces into one upload, and
 * fire-and-forget: offline just means the next edit (or finished workout)
 * backs up instead. */

import { backupToCloud } from "./cloudBackup";

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: string | null = null;

export function scheduleBackup(userId: string, delayMs = 4000): void {
  pending = userId;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const p = pending;
    pending = null;
    timer = null;
    if (p) void backupToCloud(p).catch(() => {});
  }, delayMs);
}
