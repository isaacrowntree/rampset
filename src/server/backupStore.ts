/** R2-backed backup snapshots, one namespace per account.
 * Pure functions over a minimal bucket interface so the logic is testable
 * without a Workers runtime. */

export interface PutOptions {
  /** R2 conditional write: refuse (return null) if the object moved on. */
  onlyIf?: { etagMatches?: string };
}

export interface BackupBucket {
  put(key: string, value: string, options?: PutOptions): Promise<unknown | null>;
  get(key: string): Promise<{ text(): Promise<string>; etag?: string } | null>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: { key: string }[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string | string[]): Promise<void>;
}

interface Row {
  id: string;
  [k: string]: unknown;
}
interface SetRow extends Row {
  workoutId?: string;
}

const editedAt = (w: Row) => (typeof w.editedAt === "number" ? w.editedAt : 0);

export interface BackupData {
  format?: string;
  version?: number;
  exportedAt?: string;
  userId?: string;
  exercises?: Row[];
  programs?: Row[];
  programDays?: Row[];
  programExercises?: Row[];
  workouts?: Row[];
  sets?: SetRow[];
}

function unionById<T extends Row>(existing: T[], incoming: T[]): T[] {
  const byId = new Map<string, T>();
  for (const r of existing) byId.set(r.id, r);
  for (const r of incoming) byId.set(r.id, r); // incoming is the fresher edit
  return [...byId.values()];
}

/** Combine what's published with what a device is publishing.
 *
 * `latest.json` is the SHARED view, but each device uploads its own whole
 * database. A blind write therefore lets a device that hasn't pulled yet
 * publish a history in which the workouts it never saw simply never happened
 * — which is how a real workout was erased from this bucket. Union instead:
 * a device can add to the shared view, never subtract from it.
 *
 * Deletion then needs an explicit authority, because union alone can't drop a
 * row: that's `tombstonedWorkoutIds`, taken from the journal's deleteWorkout
 * ops. Program structure stays last-writer-wins — it isn't journalled, so
 * unioning it would resurrect exercises the user removed from their program. */
export function mergeBackups(
  existing: BackupData | null,
  incoming: BackupData,
  tombstonedWorkoutIds: string[],
): BackupData {
  const dead = new Set(tombstonedWorkoutIds);

  // Per workout, one side wins outright — the newer edit (incoming on a
  // tie) — and brings its own sets. A set-by-set union would keep a set an
  // edit removed, and let a phone that hasn't pulled an edit yet upload its
  // old copy over the correction.
  const before = new Map((existing?.workouts ?? []).map((w) => [w.id, w]));
  const after = new Map((incoming.workouts ?? []).map((w) => [w.id, w]));
  const from = new Map<string, "existing" | "incoming">();
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (dead.has(id)) continue;
    const e = before.get(id);
    const i = after.get(id);
    from.set(id, !i ? "existing" : !e ? "incoming" : editedAt(i) >= editedAt(e) ? "incoming" : "existing");
  }
  const workouts = [...from].map(([id, side]) => (side === "existing" ? before : after).get(id)!);
  const setsOf = (side: "existing" | "incoming", sets: SetRow[]) =>
    sets.filter((s) => s.workoutId !== undefined && from.get(s.workoutId) === side);
  const sets = [
    ...setsOf("existing", existing?.sets ?? []),
    ...setsOf("incoming", incoming.sets ?? []),
  ];
  const exercises = unionById(existing?.exercises ?? [], incoming.exercises ?? []);

  return { ...incoming, workouts, sets, exercises };
}

// A decade of workouts is ~2MB. Anyone can sign up, so this is also the most
// one account can make us store per upload.
export const MAX_BYTES = 10 * 1024 * 1024;
/** latest.json is a union of every upload, so it grows past any one of them;
 * past this it's no longer a lifting history. */
const MAX_LATEST_BYTES = 2 * MAX_BYTES;
/** Hourly rollback points kept per account, newest first. A lifter who backs
 * up a few times a day keeps months; a script that uploads every hour can't
 * make us keep more than this. (An R2 lifecycle rule on snapshots/ expires
 * them by age as well — see the README.) */
export const MAX_SNAPSHOTS = 200;

/** A backup we refuse for what it is, not for anything that went wrong on our
 * side: the route answers these with a 400 and their message. */
export class BackupInputError extends Error {}

/** Another device kept publishing first. Nothing's wrong; try again. */
export class BackupContendedError extends Error {}

const bytes = (s: string) => new TextEncoder().encode(s).byteLength;

const COLLECTIONS = ["exercises", "programs", "programDays", "programExercises", "workouts", "sets"] as const;

/** Shape-check an upload before anything is stored: a well-formed file for
 * this account, or a BackupInputError. */
function parseUpload(json: string, userId: string): BackupData {
  if (bytes(json) > MAX_BYTES) throw new BackupInputError("Backup too large");
  let data: BackupData;
  try {
    data = JSON.parse(json) as BackupData;
  } catch {
    throw new BackupInputError("Not a LiftLog backup");
  }
  if (!data || typeof data !== "object" || data.format !== "liftlog-backup" || data.version !== 1) {
    throw new BackupInputError("Not a LiftLog backup");
  }
  // The session decides where this is filed; a file naming another account
  // means the device and the session have parted.
  if (data.userId !== userId) throw new BackupInputError("This backup belongs to a different account");
  for (const name of COLLECTIONS) {
    const rows = data[name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw new BackupInputError(`Backup's ${name} isn't a list`);
    for (const row of rows as unknown[]) {
      if (!row || typeof row !== "object" || typeof (row as Row).id !== "string") {
        throw new BackupInputError(`Backup has a malformed row in ${name}`);
      }
      const owner = (row as Row).userId;
      if (owner !== undefined && owner !== userId) {
        throw new BackupInputError(`Backup has another account's row in ${name}`);
      }
    }
  }
  return data;
}

function sanitize(userId: string): string {
  return userId.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function backupKeys(userId: string, now: Date) {
  const who = sanitize(userId);
  // One snapshot per hour, overwritten within it: a rollback point every
  // hour is plenty, and anyone can sign up — uploads mustn't pile up forever.
  const stamp = now.toISOString().slice(0, 13);
  return {
    // Dated snapshots live under snapshots/ so an R2 lifecycle rule can
    // expire them without ever touching the latest.json pointers.
    snapshot: `snapshots/${who}/${stamp}.json`,
    latest: `backups/${who}/latest.json`,
    /** Written when the account is deleted: an upload already in flight
     * checks it and cleans up after itself rather than outliving the account. */
    deleted: `deleted/${who}`,
  };
}

export interface StoredSummary {
  workouts: number;
  sets: number;
}

export async function storeBackup(
  bucket: BackupBucket,
  userId: string,
  json: string,
  now: Date,
  /** Workouts the journal says are deleted — union can't drop rows on its own. */
  tombstonedWorkoutIds: string[] = [],
): Promise<StoredSummary> {
  const data = parseUpload(json, userId);
  const keys = backupKeys(userId, now);

  // The dated snapshot is this device's own view, verbatim: the forensic
  // record of what it held. Never merged — that's what makes it a rollback.
  await bucket.put(keys.snapshot, json);
  await pruneSnapshots(bucket, userId);

  // The shared view. Conditional on the etag we read, so a publish that lands
  // between our read and our write is retried against it rather than lost.
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await bucket.get(keys.latest);
    const existing = current ? (JSON.parse(await current.text()) as BackupData) : null;
    const merged = mergeBackups(existing, data, tombstonedWorkoutIds);
    const body = JSON.stringify(merged);
    if (bytes(body) > MAX_LATEST_BYTES) throw new BackupInputError("Backup too large");

    const written = await bucket.put(
      keys.latest,
      body,
      current?.etag ? { onlyIf: { etagMatches: current.etag } } : undefined,
    );
    if (written !== null) {
      await refuseIfDeleted(bucket, userId);
      return {
        workouts: merged.workouts?.length ?? 0,
        sets: merged.sets?.length ?? 0,
      };
    }
  }
  await refuseIfDeleted(bucket, userId);
  throw new BackupContendedError("Backup contended — another device published first; try again");
}

/** The account was deleted while this upload was in flight: what it wrote
 * must not outlive the account. */
async function refuseIfDeleted(bucket: BackupBucket, userId: string): Promise<void> {
  if (!(await bucket.get(backupKeys(userId, new Date(0)).deleted))) return;
  await deleteBackups(bucket, userId, { markDeleted: false });
  throw new BackupInputError("This account has been deleted");
}

export async function fetchLatestBackup(
  bucket: BackupBucket,
  userId: string,
): Promise<string | null> {
  const keys = backupKeys(userId, new Date(0));
  const obj = await bucket.get(keys.latest);
  return obj ? obj.text() : null;
}

async function snapshotKeys(bucket: BackupBucket, userId: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: `snapshots/${sanitize(userId)}/`, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

/** Keep the newest MAX_SNAPSHOTS. Keys are hour stamps, so name order is age. */
async function pruneSnapshots(bucket: BackupBucket, userId: string): Promise<void> {
  const keys = (await snapshotKeys(bucket, userId)).sort();
  const old = keys.slice(0, Math.max(0, keys.length - MAX_SNAPSHOTS));
  if (old.length) await bucket.delete(old);
}

/** Every object an account has: its latest view and all dated snapshots. Also
 * leaves a marker, so an upload still in flight removes what it writes. */
export async function deleteBackups(
  bucket: BackupBucket,
  userId: string,
  { markDeleted = true }: { markDeleted?: boolean } = {},
): Promise<void> {
  const keys = backupKeys(userId, new Date(0));
  if (markDeleted) await bucket.put(keys.deleted, new Date().toISOString());
  await bucket.delete(keys.latest);
  const snapshots = await snapshotKeys(bucket, userId);
  if (snapshots.length) await bucket.delete(snapshots);
}
