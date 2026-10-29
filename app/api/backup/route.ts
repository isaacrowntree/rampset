/** Cloud backup endpoint. Runs on the Worker; the R2 bucket holds one
 * namespace per account, chosen by the session — never by the request. */

import { requireAccount } from "@/server/auth/deps";
import { journalFor } from "@/server/journal";
import { DELETE_WORKOUT, tombstonedWorkoutIds } from "@/server/tombstones";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readLimited } from "@/server/body";
import {
  BackupContendedError,
  BackupInputError,
  MAX_BYTES,
  storeBackup,
  fetchLatestBackup,
  type BackupBucket,
} from "@/server/backupStore";

export const dynamic = "force-dynamic";

function bucket(): BackupBucket | null {
  const { env } = getCloudflareContext();
  return (env as { BACKUPS?: BackupBucket }).BACKUPS ?? null;
}

/** Which workouts are deleted, per the journal.
 *
 * latest.json is merged by union so a device that's behind can't erase rows it
 * never saw — but union can only ADD, so without this a deleted workout walks
 * back in from whichever device still holds it. Failing closed (returning
 * none) would resurrect deletions, so a journal we can't reach aborts the
 * publish rather than quietly undoing one. */
async function tombstonesFor(userId: string): Promise<string[]> {
  const journal = journalFor(userId);
  if (!journal) return [];
  const { ops } = await journal.opsByKind(DELETE_WORKOUT);
  return tombstonedWorkoutIds(ops);
}

export async function POST(req: Request) {
  const userId = await requireAccount(req);
  if (userId instanceof Response) return userId;
  const backups = bucket();
  if (!backups) {
    return Response.json({ error: "Backup storage not configured" }, { status: 503 });
  }
  const body = await readLimited(req, MAX_BYTES);
  if (body === null) return Response.json({ error: "Backup too large" }, { status: 413 });
  try {
    const summary = await storeBackup(
      backups,
      userId,
      body,
      new Date(),
      await tombstonesFor(userId),
    );
    return Response.json({ ok: true, ...summary });
  } catch (e) {
    if (e instanceof BackupInputError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof BackupContendedError) return Response.json({ error: e.message }, { status: 409 });
    // Anything else is ours (R2, the journal) — not something to show, and
    // not the upload's fault.
    console.error("backup failed", e instanceof Error ? e.name : typeof e);
    return Response.json({ error: "Backup failed — try again later" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const userId = await requireAccount(req);
  if (userId instanceof Response) return userId;
  const backups = bucket();
  if (!backups) {
    return Response.json({ error: "Backup storage not configured" }, { status: 503 });
  }
  const json = await fetchLatestBackup(backups, userId);
  if (json === null) {
    return Response.json({ error: "No cloud backup yet" }, { status: 404 });
  }
  return new Response(json, {
    headers: { "content-type": "application/json" },
  });
}
