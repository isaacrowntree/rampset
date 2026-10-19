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
const MAX_BYTES = 10 * 1024 * 1024;

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
  if (json.length > MAX_BYTES) {
    throw new Error("Backup too large");
  }
  const data = JSON.parse(json) as BackupData;
  if (data.format !== "liftlog-backup" || data.version !== 1) {
    throw new Error("Not a LiftLog backup");
  }

  const keys = backupKeys(userId, now);

  // The dated snapshot is this device's own view, verbatim: the forensic
  // record of what it held. Never merged — that's what makes it a rollback.
  await bucket.put(keys.snapshot, json);

  // The shared view. Conditional on the etag we read, so a publish that lands
  // between our read and our write is retried against it rather than lost.
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await bucket.get(keys.latest);
    const existing = current ? (JSON.parse(await current.text()) as BackupData) : null;
    const merged = mergeBackups(existing, data, tombstonedWorkoutIds);

    const written = await bucket.put(
      keys.latest,
      JSON.stringify(merged),
      current?.etag ? { onlyIf: { etagMatches: current.etag } } : undefined,
    );
    if (written !== null) {
      return {
        workouts: merged.workouts?.length ?? 0,
        sets: merged.sets?.length ?? 0,
      };
    }
  }
  throw new Error("Backup contended — another device published first; try again");
}

export async function fetchLatestBackup(
  bucket: BackupBucket,
  userId: string,
): Promise<string | null> {
  const keys = backupKeys(userId, new Date(0));
  const obj = await bucket.get(keys.latest);
  return obj ? obj.text() : null;
}

/** Every object an account has: its latest view and all dated snapshots. */
export async function deleteBackups(bucket: BackupBucket, userId: string): Promise<void> {
  const who = sanitize(userId);
  await bucket.delete(backupKeys(userId, new Date(0)).latest);
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: `snapshots/${who}/`, cursor });
    if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
