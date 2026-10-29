"use client";

/** Client side of cloud backups. Fire-and-forget friendly: the gym has no
 * signal, so callers treat failures as "will back up next time online". */

import { exportBackup, restoreBackup, type RestoreSummary } from "@/db/backup";
import { mayWriteAs } from "@/lib/identityGate";

/** Names the account this device holds, so the server can refuse a request
 * whose session belongs to someone else (see wrongAccount on the server). */
export const accountHeader = (userId: string) => ({ "x-account": userId });

export async function backupToCloud(userId: string): Promise<{ ok: boolean; error?: string }> {
  // The route files this under the session's account, not this device's —
  // if they've parted, uploading would overwrite someone else's snapshot.
  if (!mayWriteAs(userId)) {
    return { ok: false, error: "Not signed in — sign in to back up" };
  }
  try {
    const json = await exportBackup(userId);
    const res = await fetch("/api/backup", {
      method: "POST",
      headers: { "content-type": "application/json", ...accountHeader(userId) },
      body: json,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Offline — will back up when online" };
  }
}

/** Raw latest snapshot, or null when offline / none exists. */
export async function getLatestCloudBackup(userId: string): Promise<string | null> {
  try {
    const res = await fetch("/api/backup", { headers: accountHeader(userId), signal: AbortSignal.timeout(8000) });
    return res.ok ? res.text() : null;
  } catch {
    return null;
  }
}

export async function restoreFromCloud(
  userId: string,
): Promise<{ ok: boolean; summary?: RestoreSummary; error?: string }> {
  if (!mayWriteAs(userId)) {
    return { ok: false, error: "Not signed in — sign in to restore" };
  }
  try {
    const res = await fetch("/api/backup", { headers: accountHeader(userId) });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    }
    const summary = await restoreBackup(userId, await res.text(), { fromCloud: true });
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Restore failed" };
  }
}
