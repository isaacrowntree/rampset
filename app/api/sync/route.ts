/** Sync endpoint: forwards push/pull to the signed-in account's own
 * SyncJournal Durable Object. The wire format is durable-sync's client
 * protocol: POST `{ ops }`, GET `?since=<seq>`. */

import { requireAccount } from "@/server/auth/deps";
import { journalFor, type JournalStub } from "@/server/journal";
import type { JournalOp } from "durable-sync/server";

export const dynamic = "force-dynamic";

/** A push is one finished workout plus whatever queued up offline. Anyone can
 * sign up, so these bound what a single request appends to a journal. A
 * bigger backlog isn't refused — the client sends its whole outbox every
 * time, so a refusal would be forever — it's taken a batch at a time: the
 * client drains what comes back as stored and sends the rest next sync. */
const MAX_OPS = 100;
const MAX_BYTES = 1024 * 1024;
/** Past this, it isn't a backlog. */
const MAX_BODY = 50 * 1024 * 1024;

function batch(ops: JournalOp[]): JournalOp[] {
  const taken: JournalOp[] = [];
  let bytes = 0;
  for (const op of ops.slice(0, MAX_OPS)) {
    const size = JSON.stringify(op).length;
    if (taken.length > 0 && bytes + size > MAX_BYTES) break;
    taken.push(op);
    bytes += size;
  }
  return taken;
}

async function journalOrError(req: Request): Promise<JournalStub | Response> {
  const userId = await requireAccount(req);
  if (userId instanceof Response) return userId;
  return journalFor(userId) ?? Response.json({ error: "Sync not configured" }, { status: 503 });
}

export async function POST(req: Request) {
  const journal = await journalOrError(req);
  if (journal instanceof Response) return journal;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) {
    return Response.json({ error: "Push too large" }, { status: 413 });
  }
  const text = await req.text();
  const body = (() => {
    try {
      return JSON.parse(text) as { ops?: unknown } | null;
    } catch {
      return null;
    }
  })();
  const ops = Array.isArray(body?.ops) ? (body.ops as JournalOp[]) : [];
  return Response.json(await journal.push(batch(ops)));
}

export async function GET(req: Request) {
  const journal = await journalOrError(req);
  if (journal instanceof Response) return journal;
  const params = new URL(req.url).searchParams;
  const since = Number(params.get("since") ?? "0") || 0;
  return Response.json(await journal.pull(since, params.get("snapshot") === "1"));
}
