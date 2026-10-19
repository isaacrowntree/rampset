/** Everything an account owns outside the Auth DO: its journal and its
 * backups. Taken from bindings directly (no OpenNext context), so the
 * integration suite runs the very same function on real R2 and a real
 * SyncJournal. */

import { deleteBackups, type BackupBucket } from "@/server/backupStore";

interface JournalNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { reset(): Promise<unknown> };
}

export interface UserDataEnv {
  SYNC_JOURNAL?: JournalNamespace;
  BACKUPS?: BackupBucket;
}

export async function deleteUserData(env: UserDataEnv, userId: string): Promise<void> {
  const ns = env.SYNC_JOURNAL;
  if (ns) await ns.get(ns.idFromName(userId)).reset();
  if (env.BACKUPS) await deleteBackups(env.BACKUPS, userId);
}
