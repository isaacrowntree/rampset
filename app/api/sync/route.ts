/** Sync endpoint: forwards push/pull to the caller's own SyncJournal
 * Durable Object, addressed by their Access identity. The wire format is
 * durable-sync's client protocol: POST `{ ops }`, GET `?since=<seq>`. */

import { journalFor, type JournalStub } from "@/server/journal";
import type { JournalOp } from "durable-sync/server";

export const dynamic = "force-dynamic";

function journalOrError(req: Request): JournalStub | Response {
  const email =
    req.headers.get("cf-access-authenticated-user-email") ??
    (process.env.NODE_ENV === "development"
      ? req.headers.get("x-liftlog-dev-user")
      : null);
  if (!email) {
    return Response.json({ error: "No authenticated identity" }, { status: 401 });
  }
  return journalFor(email) ?? Response.json({ error: "Sync not configured" }, { status: 503 });
}

export async function POST(req: Request) {
  const journal = journalOrError(req);
  if (journal instanceof Response) return journal;
  const body = (await req.json().catch(() => null)) as { ops?: unknown } | null;
  const ops = Array.isArray(body?.ops) ? (body.ops as JournalOp[]) : [];
  return Response.json(await journal.push(ops));
}

export async function GET(req: Request) {
  const journal = journalOrError(req);
  if (journal instanceof Response) return journal;
  const params = new URL(req.url).searchParams;
  const since = Number(params.get("since") ?? "0") || 0;
  return Response.json(await journal.pull(since, params.get("snapshot") === "1"));
}
