"use client";

/** Full-fidelity JSON backup: everything the app knows about one user,
 * restorable onto a fresh device. The CSV export is for portability;
 * this is the real backup. */

import { db } from "./db";

export interface BackupFile {
  format: "liftlog-backup";
  version: 1;
  exportedAt: string;
  userId: string;
  exercises: unknown[];
  programs: unknown[];
  programDays: unknown[];
  programExercises: unknown[];
  workouts: unknown[];
  sets: unknown[];
}

export interface RestoreSummary {
  workouts: number;
  sets: number;
  exercises: number;
}

export async function exportBackup(userId: string): Promise<string> {
  const programs = await db.programs.where({ userId }).toArray();
  const programIds = programs.map((p) => p.id);
  const programDays = (await db.programDays.toArray()).filter((d) =>
    programIds.includes(d.programId),
  );
  const dayIds = new Set(programDays.map((d) => d.id));
  const programExercises = (await db.programExercises.toArray()).filter((pe) =>
    dayIds.has(pe.programDayId),
  );

  const backup: BackupFile = {
    format: "liftlog-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    userId,
    exercises: await db.exercises.where({ userId }).toArray(),
    programs,
    programDays,
    programExercises,
    workouts: await db.workouts.where({ userId }).toArray(),
    sets: await db.sets.where({ userId }).toArray(),
  };
  return JSON.stringify(backup);
}

/** Replaces ALL of the user's data with the backup's contents. A backup made
 * under another account — an old device, a previous account — is moved onto
 * this one (see moveBackup).
 *
 * `fromCloud`: the cloud only ever holds this account's own snapshot, so one
 * naming a different account means the session and this device have parted —
 * refuse it rather than adopt someone else's history. (A profile from before
 * accounts — an id without the `u_`/`local_` of isAccountId — still moves
 * over.) */
export async function restoreBackup(
  userId: string,
  json: string,
  { fromCloud = false }: { fromCloud?: boolean } = {},
): Promise<RestoreSummary> {
  const parsed = JSON.parse(json) as BackupFile;
  if (parsed.format !== "liftlog-backup" || parsed.version !== 1) {
    throw new Error("Not a Rampset backup file");
  }
  if (fromCloud && parsed.userId !== userId && /^(u_|local_)/.test(String(parsed.userId))) {
    throw new Error("That cloud backup belongs to a different account");
  }
  const data = checkRows(parsed.userId === userId ? parsed : moveBackup(checkShape(parsed), userId), userId);

  await db.transaction(
    "rw",
    [db.exercises, db.programs, db.programDays, db.programExercises, db.workouts, db.sets],
    async () => {
      // Wipe the user's current rows.
      const oldPrograms = await db.programs.where({ userId }).toArray();
      const oldProgramIds = oldPrograms.map((p) => p.id);
      const oldDays = (await db.programDays.toArray()).filter((d) =>
        oldProgramIds.includes(d.programId),
      );
      const oldDayIds = oldDays.map((d) => d.id);
      await db.programExercises
        .filter((pe) => oldDayIds.includes(pe.programDayId))
        .delete();
      await db.programDays.filter((d) => oldProgramIds.includes(d.programId)).delete();
      await db.programs.where({ userId }).delete();
      await db.exercises.where({ userId }).delete();
      await db.sets.where({ userId }).delete();
      await db.workouts.where({ userId }).delete();

      // Load the backup's rows.
      await db.exercises.bulkAdd(data.exercises as never[]);
      await db.programs.bulkAdd(data.programs as never[]);
      await db.programDays.bulkAdd(data.programDays as never[]);
      await db.programExercises.bulkAdd(data.programExercises as never[]);
      await db.workouts.bulkAdd(data.workouts as never[]);
      await db.sets.bulkAdd(data.sets as never[]);
    },
  );

  return {
    workouts: data.workouts.length,
    sets: data.sets.length,
    exercises: data.exercises.length,
  };
}

const TABLES = ["exercises", "programs", "programDays", "programExercises", "workouts", "sets"] as const;

/** Every table a list of objects with a string id, or the file is refused. */
function checkShape(data: BackupFile): BackupFile {
  if (typeof data.userId !== "string") throw new Error("Not a Rampset backup file");
  for (const t of TABLES) {
    const rows = data[t] ?? [];
    if (!Array.isArray(rows)) throw new Error("This backup file is damaged");
    for (const row of rows as unknown[]) {
      if (!row || typeof row !== "object" || typeof (row as { id?: unknown }).id !== "string") {
        throw new Error("This backup file is damaged");
      }
    }
  }
  return data;
}

/** What a restore may write: rows owned by `userId` and nobody else, and only
 * program structure that hangs off this file's own programs. A file can't
 * plant rows for another profile on this device — they'd sit there, and the
 * next backup or import would upload them. */
function checkRows(data: BackupFile, userId: string): BackupFile {
  checkShape(data);
  for (const t of ["exercises", "programs", "workouts", "sets"] as const) {
    for (const row of data[t] as { userId?: unknown }[]) {
      if (row.userId !== userId) throw new Error("This backup file has another account's data in it");
    }
  }
  type Ref = { id: string; programId?: string; programDayId?: string; workoutId?: string };
  const ids = (rows: unknown[]) => new Set((rows as Ref[]).map((r) => r.id));
  const programs = ids(data.programs);
  const programDays = (data.programDays as Ref[]).filter((d) => programs.has(d.programId ?? ""));
  const days = ids(programDays);
  const workouts = ids(data.workouts);
  return {
    ...data,
    programDays,
    programExercises: (data.programExercises as Ref[]).filter((pe) => days.has(pe.programDayId ?? "")),
    sets: (data.sets as Ref[]).filter((s) => workouts.has(s.workoutId ?? "")),
  };
}

/** Fields that hold a row id or point at one. */
const ID_FIELDS = ["id", "userId", "exerciseId", "programId", "programDayId", "workoutId"] as const;

/** Re-home a backup onto another account.
 *
 * Rows are written verbatim, and every query is scoped by userId — so a file
 * restored under its old owner's id would wipe this account's history and
 * replace it with rows nothing can ever read. Rewrite the owner instead.
 *
 * Seeded and template ids embed the owner (`ex-<user>-squat`,
 * `day-5x5-a-<user>`, `pe-day-5x5-a-<user>-0`), and a second device rebuilds
 * exactly those ids for synced ops to land on, so those are rewritten too:
 * the owner as a whole `-`-delimited segment, never a substring of another
 * (`user-1` must not touch `user-10`). Random ids carry no owner and stay. */
export function moveBackup(data: BackupFile, toUserId: string): BackupFile {
  const from = data.userId;
  const segment = new RegExp(`-${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|-)`, "g");
  const move = (v: unknown) =>
    typeof v !== "string" ? v : v === from ? toUserId : v.replace(segment, `-${toUserId}`);

  const rows = (list: unknown[]) =>
    list.map((row) => {
      const r = { ...(row as Record<string, unknown>) };
      for (const f of ID_FIELDS) if (f in r) r[f] = move(r[f]);
      // Workouts key their prescription by exercise id.
      if (r.prescribedSets && typeof r.prescribedSets === "object") {
        r.prescribedSets = Object.fromEntries(
          Object.entries(r.prescribedSets as Record<string, number>).map(([k, n]) => [move(k), n]),
        );
      }
      return r;
    });

  return {
    ...data,
    userId: toUserId,
    exercises: rows(data.exercises),
    programs: rows(data.programs),
    programDays: rows(data.programDays),
    programExercises: rows(data.programExercises),
    workouts: rows(data.workouts),
    sets: rows(data.sets),
  };
}
