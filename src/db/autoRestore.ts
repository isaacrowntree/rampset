"use client";

/** First-run cloud restore: a device with NO workouts for a user populates
 * itself from the latest R2 snapshot. A device with any local history is
 * never touched — manual "Restore from cloud" exists for that, behind a
 * confirmation. */

import { db } from "./db";
import { restoreBackup, type RestoreSummary } from "./backup";

export async function autoRestoreIfEmpty(
  userId: string,
  fetchLatest: () => Promise<string | null>,
): Promise<RestoreSummary | null> {
  const count = await db.workouts.where({ userId }).count();
  if (count > 0) return null;

  const json = await fetchLatest();
  if (!json) return null;

  try {
    return await restoreBackup(userId, json, { fromCloud: true });
  } catch {
    // Corrupt or foreign payload — leave the fresh seed alone.
    return null;
  }
}
