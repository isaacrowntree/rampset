"use client";

/** This device's one account, as local rows.
 *
 * The server owns who you are (src/server/auth); this owns what that means on
 * the device: a users row under the account's id, and the program the lifter
 * picked, built from its template. Every id the template produces embeds the
 * account id, so a second device builds the very same rows and synced ops
 * line up across both. */

import { db } from "./db";
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

/** The device's account, if it has one. One account per device. */
export async function localUser(): Promise<User | null> {
  return (await db.users.toCollection().first()) ?? null;
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
