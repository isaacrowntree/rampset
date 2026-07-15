"use client";

/** Client side of cloud backups. Fire-and-forget friendly: the gym has no
 * signal, so callers treat failures as "will back up next time online". */

import { exportBackup, restoreBackup, type RestoreSummary } from "@/db/backup";
import { mayWriteAs } from "@/lib/identityGate";

function devHeaders(email: string): HeadersInit {
  // Behind Cloudflare Access the identity header is injected by the edge;
  // in local dev we supply one so the route works.
  return process.env.NODE_ENV === "development"
    ? { "x-liftlog-dev-user": email }
    : {};
}

export async function backupToCloud(
  userId: string,
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  // The route files this under the Access identity, not this avatar — so
  // backing up while switched to someone else would overwrite THEIR snapshot
  // with our database, or ours with theirs.
  if (!mayWriteAs(email)) {
    return { ok: false, error: "Not signed in as this user — skipping backup" };
  }
  try {
    const json = await exportBackup(userId);
    const res = await fetch("/api/backup", {
      method: "POST",
      headers: { "content-type": "application/json", ...devHeaders(email) },
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
export async function getLatestCloudBackup(email: string): Promise<string | null> {
  try {
    const res = await fetch("/api/backup", {
      headers: devHeaders(email),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? res.text() : null;
  } catch {
    return null;
  }
}

export async function restoreFromCloud(
  userId: string,
  email: string,
): Promise<{ ok: boolean; summary?: RestoreSummary; error?: string }> {
  try {
    const res = await fetch("/api/backup", { headers: devHeaders(email) });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    }
    const summary = await restoreBackup(userId, await res.text());
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Restore failed" };
  }
}
