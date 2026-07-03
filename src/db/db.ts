"use client";

/** Offline-first store: IndexedDB via Dexie is the source of truth on-device. */

import Dexie, { type EntityTable } from "dexie";
import type {
  User,
  Exercise,
  Program,
  ProgramDay,
  ProgramExercise,
  Workout,
  SetEntry,
} from "@/lib/types";

export interface Setting {
  key: string;
  value: unknown;
}

export class LiftLogDB extends Dexie {
  users!: EntityTable<User, "id">;
  exercises!: EntityTable<Exercise, "id">;
  programs!: EntityTable<Program, "id">;
  programDays!: EntityTable<ProgramDay, "id">;
  programExercises!: EntityTable<ProgramExercise, "id">;
  workouts!: EntityTable<Workout, "id">;
  sets!: EntityTable<SetEntry, "id">;
  settings!: EntityTable<Setting, "key">;

  constructor(name = "liftlog") {
    super(name);
    this.version(1).stores({
      users: "id, email",
      exercises: "id, userId, name",
      programs: "id, userId",
      programDays: "id, programId, position",
      programExercises: "id, programDayId, exerciseId, position",
      workouts: "id, userId, date, [userId+date]",
      sets: "id, workoutId, userId, exerciseId, [userId+exerciseId], completedTs",
      settings: "key",
    });
  }
}

export const db = new LiftLogDB();

/** ULID-ish sortable client id (offline-safe, no coordination needed). */
export function newId(): string {
  const t = Date.now().toString(36).padStart(9, "0");
  const r = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => (b % 36).toString(36))
    .join("");
  return `${t}${r}`;
}
