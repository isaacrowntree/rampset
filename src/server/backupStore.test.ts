import { describe, it, expect } from "vitest";
import {
  MAX_SNAPSHOTS,
  backupKeys,
  storeBackup,
  fetchLatestBackup,
  deleteBackups,
  mergeBackups,
  type BackupBucket,
} from "./backupStore";

/** Models R2's conditional put: a write carrying a stale etag is refused
 * (returns null) rather than silently clobbering. */
function fakeBucket() {
  const store = new Map<string, string>();
  const etags = new Map<string, string>();
  let seq = 0;
  const bucket: BackupBucket = {
    async put(key, value, options) {
      const expected = options?.onlyIf?.etagMatches;
      if (expected !== undefined && etags.get(key) !== expected) return null;
      store.set(key, value);
      etags.set(key, `etag-${++seq}`);
      return {};
    },
    async get(key) {
      const v = store.get(key);
      return v === undefined
        ? null
        : { text: async () => v, etag: etags.get(key) };
    },
    // One key per page, so a paginated delete is actually exercised.
    async list({ prefix, cursor }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const at = cursor ? keys.indexOf(cursor) : 0;
      const page = keys.slice(at, at + 1);
      return { objects: page.map((key) => ({ key })), truncated: at + 1 < keys.length, cursor: keys[at + 1] };
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
  return { bucket, store, etags };
}

const backup = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: "liftlog-backup",
    version: 1,
    exportedAt: "2026-07-03T00:00:00Z",
    userId: "u_a",
    exercises: [],
    programs: [],
    programDays: [],
    programExercises: [],
    workouts: [],
    sets: [],
    ...over,
  });
const parse = (s: string | undefined) => JSON.parse(s ?? "{}");

describe("backupKeys", () => {
  it("namespaces by account and keeps a latest pointer", () => {
    const keys = backupKeys("u_Ab-9", new Date("2026-07-03T10:30:00Z"));
    expect(keys.latest).toBe("backups/u_Ab-9/latest.json");
    expect(keys.snapshot).toBe("snapshots/u_Ab-9/2026-07-03T10.json");
  });

  it("strips path-hostile characters", () => {
    const keys = backupKeys("../a/b\\c#?d", new Date("2026-07-03T00:00:00Z"));
    expect(keys.latest).toBe("backups/___a_b_c__d/latest.json");
  });
});

describe("storeBackup", () => {
  it("writes both a dated snapshot and the latest pointer", async () => {
    const { bucket, store } = fakeBucket();
    const VALID = backup({ workouts: [{ id: "w1" }], sets: [{ id: "s1", workoutId: "w1" }, { id: "s2", workoutId: "w1" }] });
    const result = await storeBackup(bucket, "u_a", VALID, new Date("2026-07-03T10:30:00Z"));
    expect(result.workouts).toBe(1);
    expect(result.sets).toBe(2);
    expect(store.size).toBe(2);
    expect(parse(store.get("backups/u_a/latest.json")).workouts).toEqual([{ id: "w1" }]);
  });

  /** latest.json is the SHARED view. It used to be a blind put of whatever the
   * uploading device happened to hold, so a device that hadn't pulled yet
   * published a history in which the workouts it never saw simply never
   * happened. That is how a real workout was erased from the cloud. */
  it("keeps workouts the uploading device never saw", async () => {
    const { bucket, store } = fakeBucket();
    // Device A publishes its workout.
    await storeBackup(bucket, "u_a", backup({
      workouts: [{ id: "wA" }], sets: [{ id: "sA", workoutId: "wA" }],
    }), new Date("2026-07-03T10:00:00Z"));

    // Device B has never pulled wA, and publishes only its own.
    await storeBackup(bucket, "u_a", backup({
      workouts: [{ id: "wB" }], sets: [{ id: "sB", workoutId: "wB" }],
    }), new Date("2026-07-03T11:00:00Z"));

    const latest = parse(store.get("backups/u_a/latest.json"));
    expect(latest.workouts.map((w: { id: string }) => w.id).sort()).toEqual(["wA", "wB"]);
    expect(latest.sets.map((s: { id: string }) => s.id).sort()).toEqual(["sA", "sB"]);
  });

  it("keeps the dated snapshot as the device's own unmerged view", async () => {
    const { bucket, store } = fakeBucket();
    await storeBackup(bucket, "u_a", backup({ workouts: [{ id: "wA" }] }), new Date("2026-07-03T10:00:00Z"));
    const own = backup({ workouts: [{ id: "wB" }] });
    await storeBackup(bucket, "u_a", own, new Date("2026-07-03T11:00:00Z"));

    // The snapshot is the forensic record of what THIS device held.
    expect(store.get("snapshots/u_a/2026-07-03T11.json")).toBe(own);
  });

  /** Union-by-id can never drop a row, so a deleted workout would walk back in
   * from whichever device still holds it. The journal's deleteWorkout ops are
   * the authority on what is gone. */
  it("drops tombstoned workouts and their orphaned sets", async () => {
    const { bucket, store } = fakeBucket();
    await storeBackup(bucket, "u_a", backup({
      workouts: [{ id: "wKeep" }, { id: "wGone" }],
      sets: [{ id: "s1", workoutId: "wKeep" }, { id: "s2", workoutId: "wGone" }],
    }), new Date("2026-07-03T10:00:00Z"));

    // A device that still holds the deleted workout re-publishes it.
    await storeBackup(bucket, "u_a", backup({
      workouts: [{ id: "wKeep" }, { id: "wGone" }],
      sets: [{ id: "s1", workoutId: "wKeep" }, { id: "s2", workoutId: "wGone" }],
    }), new Date("2026-07-03T11:00:00Z"), ["wGone"]);

    const latest = parse(store.get("backups/u_a/latest.json"));
    expect(latest.workouts.map((w: { id: string }) => w.id)).toEqual(["wKeep"]);
    expect(latest.sets.map((s: { id: string }) => s.id)).toEqual(["s1"]);
  });

  it("refuses to publish against a stale read rather than clobbering", async () => {
    const { bucket, etags } = fakeBucket();
    await storeBackup(bucket, "u_a", backup({ workouts: [{ id: "wA" }] }), new Date("2026-07-03T10:00:00Z"));
    // Every conditional put fails: someone else keeps winning the race.
    const contended: BackupBucket = {
      ...bucket,
      async put(key, value, options) {
        if (options?.onlyIf) return null;
        return bucket.put(key, value);
      },
    };
    await expect(
      storeBackup(contended, "u_a", backup({ workouts: [{ id: "wB" }] }), new Date("2026-07-03T11:00:00Z")),
    ).rejects.toThrow(/contend|busy|try again/i);
    expect(etags.size).toBeGreaterThan(0);
  });

  it("rejects payloads that are not LiftLog backups", async () => {
    const { bucket } = fakeBucket();
    await expect(storeBackup(bucket, "u_a", '{"nope":true}', new Date())).rejects.toThrow(
      /not a liftlog backup/i,
    );
    await expect(storeBackup(bucket, "u_a", "not json", new Date())).rejects.toThrow();
  });

  it("refuses a file naming another account, or carrying another account's rows", async () => {
    const { bucket, store } = fakeBucket();
    await expect(storeBackup(bucket, "u_a", backup({ userId: "u_b" }), new Date())).rejects.toThrow(/different account/);
    await expect(
      storeBackup(bucket, "u_a", backup({ workouts: [{ id: "w1", userId: "u_b" }] }), new Date()),
    ).rejects.toThrow(/another account's row/);
    expect(store.size).toBe(0);
  });

  it("refuses malformed collections before storing anything", async () => {
    const { bucket, store } = fakeBucket();
    await expect(storeBackup(bucket, "u_a", backup({ workouts: "x" }), new Date())).rejects.toThrow(/isn't a list/);
    await expect(storeBackup(bucket, "u_a", backup({ sets: [{ noId: 1 }] }), new Date())).rejects.toThrow(/malformed/);
    await expect(storeBackup(bucket, "u_a", "null", new Date())).rejects.toThrow(/not a liftlog backup/i);
    expect(store.size).toBe(0);
  });

  it("measures size in bytes, not characters", async () => {
    const { bucket } = fakeBucket();
    const VALID = backup();
    // 4M three-byte characters: 12 MB, though only 4M characters long.
    const wide = VALID.slice(0, -1) + ',"pad":"' + "€".repeat(4 * 1024 * 1024) + '"}';
    await expect(storeBackup(bucket, "u_a", wide, new Date())).rejects.toThrow(/too large/i);
  });

  it("keeps only the newest snapshots", async () => {
    const { bucket, store } = fakeBucket();
    const start = Date.parse("2026-07-03T00:00:00Z");
    for (let h = 0; h < MAX_SNAPSHOTS + 3; h++) {
      await storeBackup(bucket, "u_a", backup(), new Date(start + h * 3600_000));
    }
    const snaps = [...store.keys()].filter((k) => k.startsWith("snapshots/u_a/")).sort();
    expect(snaps).toHaveLength(MAX_SNAPSHOTS);
    expect(snaps[0]).toBe(backupKeys("u_a", new Date(start + 3 * 3600_000)).snapshot);
  });

  // Deletion runs while an upload that already passed the session check is
  // still writing. What it writes mustn't outlive the account.
  it("an upload landing after the account was deleted removes what it wrote", async () => {
    const { bucket, store } = fakeBucket();
    await deleteBackups(bucket, "u_a");
    await expect(storeBackup(bucket, "u_a", backup(), new Date())).rejects.toThrow(/deleted/);
    expect([...store.keys()].filter((k) => k.startsWith("backups/") || k.startsWith("snapshots/"))).toEqual([]);
  });

  it("rejects oversized payloads", async () => {
    const { bucket } = fakeBucket();
    const VALID = backup();
    const huge = VALID.slice(0, -1) + ',"pad":"' + "x".repeat(11 * 1024 * 1024) + '"}';
    await expect(storeBackup(bucket, "u_a", huge, new Date())).rejects.toThrow(/too large/i);
  });
});

describe("fetchLatestBackup", () => {
  it("returns the latest backup or null", async () => {
    const { bucket } = fakeBucket();
    expect(await fetchLatestBackup(bucket, "u_a")).toBeNull();
    await storeBackup(bucket, "u_a", backup({ workouts: [{ id: "w1" }] }), new Date());
    expect(parse(await fetchLatestBackup(bucket, "u_a") ?? "{}").workouts).toEqual([{ id: "w1" }]);
  });

  it("does not leak across users", async () => {
    const { bucket } = fakeBucket();
    await storeBackup(bucket, "u_a", backup(), new Date());
    expect(await fetchLatestBackup(bucket, "u_other")).toBeNull();
  });
});

describe("deleteBackups", () => {
  it("removes the account's latest view and every snapshot, and nobody else's", async () => {
    const { bucket, store } = fakeBucket();
    for (const hour of ["10", "11", "12"]) {
      await storeBackup(bucket, "u_a", backup(), new Date(`2026-07-03T${hour}:00:00Z`));
    }
    await storeBackup(bucket, "u_other", backup({ userId: "u_other" }), new Date());
    await deleteBackups(bucket, "u_a");
    // Only the marker that turns away an upload still in flight.
    expect([...store.keys()].filter((k) => k.includes("u_a"))).toEqual(["deleted/u_a"]);
    expect(await fetchLatestBackup(bucket, "u_other")).not.toBeNull();
  });
});

describe("mergeBackups", () => {
  const file = (over: Record<string, unknown> = {}) => JSON.parse(backup(over));

  // An edit removes a set. A union would keep it forever — and the journal
  // can't fix that later, because the restored row already carries the
  // edit's stamp. A workout's sets come from whichever side has it newest.
  it("drops a set an edit removed", () => {
    const existing = file({
      workouts: [{ id: "w1" }],
      sets: [{ id: "a", workoutId: "w1" }, { id: "b", workoutId: "w1" }],
    });
    const incoming = file({ workouts: [{ id: "w1", editedAt: 10 }], sets: [{ id: "a", workoutId: "w1" }] });
    expect(mergeBackups(existing, incoming, []).sets?.map((s) => s.id)).toEqual(["a"]);
  });

  // A phone that hasn't pulled the edit yet uploads its old copy. That must
  // not undo the correction for every phone restored from the cloud later.
  it("keeps the newer edit when a stale phone uploads its older copy", () => {
    const existing = file({
      workouts: [{ id: "w1", editedAt: 10 }],
      sets: [{ id: "a", workoutId: "w1", reps: 3 }],
    });
    const incoming = file({
      workouts: [{ id: "w1" }, { id: "w2" }],
      sets: [{ id: "a", workoutId: "w1", reps: 5 }, { id: "c", workoutId: "w2" }],
    });
    const merged = mergeBackups(existing, incoming, []);
    expect(merged.workouts).toEqual(expect.arrayContaining([{ id: "w1", editedAt: 10 }, { id: "w2" }]));
    expect(merged.sets).toEqual(
      expect.arrayContaining([{ id: "a", workoutId: "w1", reps: 3 }, { id: "c", workoutId: "w2" }]),
    );
    expect(merged.sets).toHaveLength(2);
  });

  it("returns the incoming file when nothing is published yet", () => {
    const incoming = file({ workouts: [{ id: "w1" }] });
    expect(mergeBackups(null, incoming, []).workouts).toEqual([{ id: "w1" }]);
  });

  it("lets the incoming row win on conflict — it is the fresher edit", () => {
    const existing = file({ workouts: [{ id: "w1", notes: "old" }] });
    const incoming = file({ workouts: [{ id: "w1", notes: "corrected" }] });
    expect(mergeBackups(existing, incoming, []).workouts).toEqual([{ id: "w1", notes: "corrected" }]);
  });

  it("carries program structure from the uploading device", () => {
    const existing = file({ programs: [{ id: "p1", name: "old" }] });
    const incoming = file({ programs: [{ id: "p1", name: "edited" }] });
    // Structure is not journalled, so it stays last-writer-wins. Documented,
    // not accidental: the alternative is resurrecting deleted exercises.
    expect(mergeBackups(existing, incoming, []).programs).toEqual([{ id: "p1", name: "edited" }]);
  });
});
