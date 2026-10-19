/** Sync endpoint: forwards push/pull to the signed-in account's own
 * SyncJournal Durable Object. The wire format is durable-sync's client
 * protocol: POST `{ ops }`, GET `?since=<seq>`. */

import { requireAccount } from "@/server/auth/deps";
import { journalFor, type JournalStub } from "@/server/journal";
import type { JournalOp } from "durable-sync/server";

export const dynamic = "force-dynamic";

/** A push is one finished workout plus whatever queued up offline. Anyone can
 * sign up, so these bound what a single request can append to a journal. */
const MAX_OPS = 100;
const MAX_BYTES = 1024 * 1024;

async function journalOrError(req: Request): Promise<JournalStub | Response> {
  const userId = await requireAccount(req);
  if (userId instanceof Response) return userId;
  return journalFor(userId) ?? Response.json({ error: "Sync not configured" }, { status: 503 });
}

export async function POST(req: Request) {
  const journal = await journalOrError(req);
  if (journal instanceof Response) return journal;
  const text = await req.text();
  if (text.length > MAX_BYTES) return Response.json({ error: "Push too large" }, { status: 413 });
  const body = (() => {
    try {
      return JSON.parse(text) as { ops?: unknown } | null;
    } catch {
      return null;
    }
  })();
  const ops = Array.isArray(body?.ops) ? (body.ops as JournalOp[]) : [];
  if (ops.length > MAX_OPS) return Response.json({ error: "Too many ops in one push" }, { status: 413 });
  return Response.json(await journal.push(ops));
}

export async function GET(req: Request) {
  const journal = await journalOrError(req);
  if (journal instanceof Response) return journal;
  const params = new URL(req.url).searchParams;
  const since = Number(params.get("since") ?? "0") || 0;
  return Response.json(await journal.pull(since, params.get("snapshot") === "1"));
}
