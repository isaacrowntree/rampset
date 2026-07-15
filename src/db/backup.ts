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

/** Replaces ALL of the user's data with the backup's contents. */
export async function restoreBackup(
  userId: string,
  json: string,
): Promise<RestoreSummary> {
  const data = JSON.parse(json) as BackupFile;
  if (data.format !== "liftlog-backup" || data.version !== 1) {
    throw new Error("Not a LiftLog backup file");
  }
  // The rows below are written verbatim, keeping the userId they were
  // exported with. Restoring someone else's file would therefore wipe THIS
  // user's history and replace it with rows no query can ever read again —
  // and report success. Refuse instead.
  if (data.userId !== userId) {
    throw new Error("This backup belongs to a different user");
  }

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
