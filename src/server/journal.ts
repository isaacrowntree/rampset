/** Typed access to a user's SyncJournal Durable Object.
 *
 * durable-sync's journal is a native Durable Object with RPC methods, so the
 * API routes call it like an object — no request-building, no string paths.
 * These are the slices of the stub and namespace the routes use; the full
 * types live in @cloudflare/workers-types, which the Next app doesn't load. */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { JournalOp, PullResult, PushResult, StoredOp } from "durable-sync/server";

export interface JournalStub {
  push(ops: JournalOp[]): Promise<PushResult>;
  pull(since: number, withSnapshot?: boolean): Promise<PullResult>;
  opsByKind(kind: string): Promise<{ ops: StoredOp[] }>;
  /** Never routed to a client — only account deletion calls it. */
  reset(): Promise<{ cleared: number; epoch: string }>;
}

interface JournalNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): JournalStub;
}

/** The journal for this account, or null when sync isn't configured. One
 * instance per account, addressed by its id. */
export function journalFor(userId: string): JournalStub | null {
  const { env } = getCloudflareContext();
  const ns = (env as { SYNC_JOURNAL?: JournalNamespace }).SYNC_JOURNAL;
  return ns ? ns.get(ns.idFromName(userId)) : null;
}
