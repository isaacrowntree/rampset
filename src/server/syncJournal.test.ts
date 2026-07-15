import { describe, it, expect } from "vitest";
import {
  MemoryOpStore,
  handlePush,
  handlePull,
  handleReset,
  type JournalOp,
} from "./syncJournal";

const op = (opId: string, n = 1): JournalOp => ({
  opId,
  kind: "finishedWorkout",
  payload: { n },
});

describe("sync journal (per-user op log)", () => {
  it("assigns increasing sequence numbers to pushed ops", () => {
    const store = new MemoryOpStore();
    const r1 = handlePush(store, [op("a"), op("b")]);
    expect(r1.seq).toBe(2);
    expect(r1.accepted).toBe(2);
    const r2 = handlePush(store, [op("c")]);
    expect(r2.seq).toBe(3);
  });

  it("ignores duplicate opIds (device retries are harmless)", () => {
    const store = new MemoryOpStore();
    handlePush(store, [op("a")]);
    const r = handlePush(store, [op("a"), op("b")]);
    expect(r.accepted).toBe(1);
    expect(handlePull(store, 0).ops).toHaveLength(2);
  });

  it("pull returns only ops after the cursor, with the new cursor", () => {
    const store = new MemoryOpStore();
    handlePush(store, [op("a"), op("b"), op("c")]);
    const r = handlePull(store, 1);
    expect(r.ops.map((o) => o.opId)).toEqual(["b", "c"]);
    expect(r.seq).toBe(3);
  });

  it("pull from the head returns nothing", () => {
    const store = new MemoryOpStore();
    handlePush(store, [op("a")]);
    const r = handlePull(store, 1);
    expect(r.ops).toHaveLength(0);
    expect(r.seq).toBe(1);
  });

  it("rejects malformed ops without poisoning the journal", () => {
    const store = new MemoryOpStore();
    const r = handlePush(store, [
      op("good"),
      { opId: "", kind: "x", payload: {} },
      { kind: "no-id" } as unknown as JournalOp,
    ]);
    expect(r.accepted).toBe(1);
    expect(handlePull(store, 0).ops.map((o) => o.opId)).toEqual(["good"]);
  });
});

/** Maintenance only. The journal is append-only by design — there is no delete
 * op — so a bad op (e.g. a workout logged only to advance a program) can never
 * be removed, and would replay onto any device that syncs from seq 0. Reset is
 * the escape hatch, safe once R2 carries the full corrected history. */
describe("journal reset", () => {
  it("empties the log so a device syncing from 0 sees nothing", () => {
    const store = new MemoryOpStore();
    handlePush(store, [op("a"), op("b"), op("bad"), op("c")]);
    expect(handlePull(store, 0).ops).toHaveLength(4);

    const r = handleReset(store);

    expect(r.cleared).toBe(4);
    expect(handlePull(store, 0).ops).toEqual([]);
    expect(handlePull(store, 0).seq).toBe(0);
  });

  it("lets the journal rebuild cleanly afterwards", () => {
    const store = new MemoryOpStore();
    handlePush(store, [op("old")]);
    handleReset(store);

    // A previously-used opId must be accepted again — the log is genuinely gone.
    const after = handlePush(store, [op("old"), op("new")]);
    expect(after.accepted).toBe(2);
    expect(after.seq).toBe(2);
  });
});
