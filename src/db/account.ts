"use client";

/** This device's one account, as local rows.
 *
 * The server owns who you are (src/server/auth); this owns what that means on
 * the device: a users row under the account's id, and the program the lifter
 * picked, built from its template. Every id the template produces embeds the
 * account id, so a second device builds the very same rows and synced ops
 * line up across both. */

import { db } from "./db";
import { exportBackup, restoreBackup } from "./backup";
import { buildProgramFromTemplate } from "./programSwitch";
import { getTemplate, PROGRAM_TEMPLATES } from "@/lib/programTemplates";
import type { User } from "@/lib/types";

/** What the server knows about an account — AccountView, as the client sees it. */
export interface Account {
  id: string;
  name: string;
  email: string | null;
  profile: {
    unit: "kg" | "lb";
    templateId: string;
    accent: "blue" | "green";
    theme: "dark" | "light";
  };
}

export function userFromAccount(account: Account): User {
  return {
    id: account.id,
    email: account.email ?? "",
    name: account.name,
    accent: account.profile.accent,
    unit: account.profile.unit,
    theme: account.profile.theme,
  };
}

/** Set this device up for `account`: its user row and, on first sight, its
 * program. Idempotent — a device that already has the account only refreshes
 * the identity fields, never the program the lifter has since edited. */
export async function adoptAccount(account: Account): Promise<User> {
  const user = userFromAccount(account);
  await db.transaction(
    "rw",
    [db.users, db.exercises, db.programs, db.programDays, db.programExercises],
    async () => {
      const existing = await db.users.get(user.id);
      await db.users.put(user);
      if (existing) return;
      const template = getTemplate(account.profile.templateId) ?? PROGRAM_TEMPLATES[0];
      await buildProgramFromTemplate(user.id, template);
    },
  );
  return user;
}

/** Account ids: server-issued (`u_…`), or device-only (`local_…`). Anything
 * else is a profile from before accounts — see legacyProfiles. */
export function isAccountId(id: string): boolean {
  return id.startsWith("u_") || id.startsWith("local_");
}

/** The device's account, if it has one. One account per device. */
export async function localUser(): Promise<User | null> {
  return (await db.users.filter((u) => isAccountId(u.id)).first()) ?? null;
}

export interface LegacyProfile {
  id: string;
  name: string;
  workouts: number;
}

/** Lifters this phone held before accounts — seeded from config, often more
 * than one on a shared phone. Their history stays here, untouched, until
 * someone moves it into an account. */
export async function legacyProfiles(): Promise<LegacyProfile[]> {
  const users = await db.users.filter((u) => !isAccountId(u.id)).toArray();
  return Promise.all(
    users.map(async (u) => ({
      id: u.id,
      name: u.name,
      workouts: await db.workouts.where({ userId: u.id }).count(),
    })),
  );
}

/** Move one old profile's history into the account: its program, weights,
 * exercises and workouts replace the account's on this device (a restore,
 * re-homed — see moveBackup), and the old profile is removed. Any other old
 * profile stays exactly as it was. Returns the workouts moved, for syncing. */
export async function moveLegacyProfile(legacyId: string, userId: string): Promise<{ workoutIds: string[] }> {
  const json = await exportBackup(legacyId);
  // One transaction: the old rows go and the moved ones land together, or
  // nothing changes. (Moved ids can equal the old ones — workout ids carry
  // no owner — so the old rows have to go first.)
  await db.transaction("rw", PROFILE_TABLES(), async () => {
    await removeProfileRows(legacyId);
    await restoreBackup(userId, json);
  });
  const workouts = await db.workouts.where({ userId }).toArray();
  return { workoutIds: workouts.filter((w) => w.endTs !== undefined).map((w) => w.id) };
}

const PROFILE_TABLES = () => [
  db.users,
  db.exercises,
  db.programs,
  db.programDays,
  db.programExercises,
  db.workouts,
  db.sets,
  db.outbox,
  db.tombstones,
];

async function removeProfileRows(userId: string): Promise<void> {
  await db.transaction(
    "rw",
    PROFILE_TABLES(),
    async () => {
      const programIds = (await db.programs.where({ userId }).toArray()).map((p) => p.id);
      const dayIds = (await db.programDays.where("programId").anyOf(programIds).toArray()).map((d) => d.id);
      await db.programExercises.where("programDayId").anyOf(dayIds).delete();
      await db.programDays.where("programId").anyOf(programIds).delete();
      await db.programs.where({ userId }).delete();
      await db.exercises.where({ userId }).delete();
      await db.sets.where({ userId }).delete();
      await db.workouts.where({ userId }).delete();
      await db.outbox.where({ userId }).delete();
      await db.tombstones.where({ userId }).delete();
      await db.users.delete(userId);
    },
  );
}

/** Workouts recorded here that haven't reached the server yet — what signing
 * out would lose. */
export async function unsyncedCount(userId: string): Promise<number> {
  return db.outbox.where({ userId }).count();
}

/** Forget everything on this device: the database and every saved setting.
 * Signing out means the next person to open the app starts clean. */
export async function wipeDevice(): Promise<void> {
  await db.delete();
  try {
    localStorage.clear();
  } catch {
    // private mode — nothing was persisted there anyway
  }
}
