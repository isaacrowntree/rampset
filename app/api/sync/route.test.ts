import { describe, it, expect, vi, beforeEach } from "vitest";

/** The route speaks durable-sync's client protocol and forwards it to the
 * journal's RPC methods: phones in the field depend on this exact shape. */
const journal = {
  push: vi.fn(async (ops: unknown[]) => ({ seq: 7, accepted: ops.length, stored: ["a"] })),
  pull: vi.fn(async (since: number) => ({ ops: [], seq: since, epoch: "e1" })),
  opsByKind: vi.fn(),
};
const journalFor = vi.fn((userId: string) => (userId ? journal : null));
vi.mock("@/server/journal", () => ({ journalFor: (id: string) => journalFor(id) }));

/** The session is the identity: a request carrying ME's cookie is u_me. */
const ME = { cookie: "session=me" };
vi.mock("@/server/auth/deps", () => ({
  requireAccount: async (req: Request) =>
    req.headers.get("cookie") === ME.cookie
      ? "u_me"
      : Response.json({ error: "Not signed in" }, { status: 401 }),
}));

const { POST, GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sync route", () => {
  it("pushes the ops from a { ops } body and returns the journal's reply", async () => {
    const ops = [{ opId: "a", kind: "finishedWorkout", payload: {} }];
    const res = await POST(
      new Request("https://app/api/sync", { method: "POST", headers: ME, body: JSON.stringify({ ops }) }),
    );
    expect(journal.push).toHaveBeenCalledWith(ops);
    expect(await res.json()).toEqual({ seq: 7, accepted: 1, stored: ["a"] });
  });

  it("treats a malformed body as no ops rather than throwing", async () => {
    await POST(new Request("https://app/api/sync", { method: "POST", headers: ME, body: "not json" }));
    expect(journal.push).toHaveBeenCalledWith([]);
  });

  it("pulls from the cursor in ?since, with a snapshot only when asked", async () => {
    await GET(new Request("https://app/api/sync?since=12", { headers: ME }));
    expect(journal.pull).toHaveBeenLastCalledWith(12, false);
    await GET(new Request("https://app/api/sync?since=0&snapshot=1", { headers: ME }));
    expect(journal.pull).toHaveBeenLastCalledWith(0, true);
  });

  it("files everything under the session's account", async () => {
    await GET(new Request("https://app/api/sync?since=0", { headers: ME }));
    expect(journalFor).toHaveBeenCalledWith("u_me");
  });

  it("refuses a request that isn't signed in", async () => {
    const res = await GET(new Request("https://app/api/sync?since=0"));
    expect(res.status).toBe(401);
    expect(journal.pull).not.toHaveBeenCalled();
  });

  // A refused push would be refused forever — the client always sends its
  // whole outbox. Take what fits; the client drains what was stored and
  // sends the rest next time.
  it("takes the first batch of a big backlog, not none of it", async () => {
    const ops = Array.from({ length: 250 }, (_, i) => ({ opId: `o${i}`, kind: "finishedWorkout", payload: {} }));
    await POST(new Request("https://app/api/sync", { method: "POST", headers: ME, body: JSON.stringify({ ops }) }));
    expect(journal.push).toHaveBeenCalledWith(ops.slice(0, 100));
  });

  it("keeps a batch under the byte budget", async () => {
    const big = "x".repeat(200_000);
    const ops = Array.from({ length: 8 }, (_, i) => ({ opId: `o${i}`, kind: "finishedWorkout", payload: { big } }));
    await POST(new Request("https://app/api/sync", { method: "POST", headers: ME, body: JSON.stringify({ ops }) }));
    expect(journal.push).toHaveBeenLastCalledWith(ops.slice(0, 5));
  });

  // Too big for a journal row: storing it would fail the whole push, every
  // time, and nothing behind it would ever sync. Left out, it stays in its
  // own client's outbox and everything else goes through.
  it("never stores an oversized op, and doesn't let it hold up the rest", async () => {
    const huge = { opId: "huge", kind: "finishedWorkout", payload: { big: "é".repeat(200_000) } };
    const ops = [huge, { opId: "a", kind: "finishedWorkout", payload: {} }];
    await POST(new Request("https://app/api/sync", { method: "POST", headers: ME, body: JSON.stringify({ ops }) }));
    expect(journal.push).toHaveBeenLastCalledWith([ops[1]]);
  });

  it("refuses a body past the limit, declared or not", async () => {
    const big = "x".repeat(17 * 1024 * 1024);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const res = await POST(
      new Request("https://app/api/sync", { method: "POST", headers: ME, body: stream, duplex: "half" } as RequestInit),
    );
    expect(res.status).toBe(413);
    expect(journal.push).not.toHaveBeenCalled();
  });

  it("answers 503 when sync isn't configured", async () => {
    journalFor.mockReturnValueOnce(null);
    const res = await GET(new Request("https://app/api/sync?since=0", { headers: ME }));
    expect(res.status).toBe(503);
  });
});
