/** Per-user sync journal: an append-only, server-ordered op log.
 * The Durable Object is the single-threaded consistency point; this module
 * is the pure logic so it's testable without a Workers runtime. */

export interface JournalOp {
  opId: string;
  kind: string;
  payload: unknown;
}

export interface StoredOp extends JournalOp {
  seq: number;
}

export interface OpStore {
  /** Returns the assigned seq, or null when opId already exists. */
  insert(op: JournalOp): number | null;
  since(seq: number): StoredOp[];
  maxSeq(): number;
  /** Drop every op. Maintenance only — see handleReset. */
  clear(): number;
}

export function handlePush(
  store: OpStore,
  ops: JournalOp[],
): { seq: number; accepted: number } {
  let accepted = 0;
  for (const op of ops ?? []) {
    if (!op || typeof op.opId !== "string" || op.opId === "") continue;
    if (typeof op.kind !== "string" || op.kind === "") continue;
    if (store.insert({ opId: op.opId, kind: op.kind, payload: op.payload }) !== null) {
      accepted++;
    }
  }
  return { seq: store.maxSeq(), accepted };
}

export function handlePull(
  store: OpStore,
  since: number,
): { ops: StoredOp[]; seq: number } {
  const from = Number.isFinite(since) && since > 0 ? since : 0;
  return { ops: store.since(from), seq: store.maxSeq() };
}

/** Empty the journal.
 *
 * The log is append-only and has no delete op, so an op that should never have
 * been recorded cannot be withdrawn — and it replays onto any device that syncs
 * from seq 0, resurrecting itself forever. Reset is the escape hatch.
 *
 * Only safe when the R2 snapshot already carries the full corrected history:
 * devices bootstrap from there, and the journal rebuilds from the next finished
 * workout. Not reachable from /api/sync (which serves only GET and POST) —
 * callers need the Durable Object binding. */
export function handleReset(store: OpStore): { cleared: number } {
  return { cleared: store.clear() };
}

/** In-memory store for tests. */
export class MemoryOpStore implements OpStore {
  private ops: StoredOp[] = [];
  private ids = new Set<string>();

  insert(op: JournalOp): number | null {
    if (this.ids.has(op.opId)) return null;
    const seq = this.ops.length + 1;
    this.ops.push({ ...op, seq });
    this.ids.add(op.opId);
    return seq;
  }
  since(seq: number): StoredOp[] {
    return this.ops.filter((o) => o.seq > seq);
  }
  maxSeq(): number {
    return this.ops.length;
  }
  clear(): number {
    const n = this.ops.length;
    this.ops = [];
    this.ids.clear();
    return n;
  }
}

/** Minimal shape of the Durable Object SQLite API we use. */
export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}

/** SQLite-backed store used inside the Durable Object. The DO is
 * single-threaded, so check-then-insert has no race. */
export class SqlOpStore implements OpStore {
  constructor(private sql: SqlLike) {
    sql.exec(
      `CREATE TABLE IF NOT EXISTS ops (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        op_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        ts INTEGER NOT NULL
      )`,
    );
  }

  insert(op: JournalOp): number | null {
    const dup = this.sql
      .exec(`SELECT seq FROM ops WHERE op_id = ?`, op.opId)
      .toArray();
    if (dup.length > 0) return null;
    this.sql.exec(
      `INSERT INTO ops (op_id, kind, payload, ts) VALUES (?, ?, ?, ?)`,
      op.opId,
      op.kind,
      JSON.stringify(op.payload ?? null),
      Date.now(),
    );
    return this.maxSeq();
  }

  since(seq: number): StoredOp[] {
    return this.sql
      .exec(`SELECT seq, op_id, kind, payload FROM ops WHERE seq > ? ORDER BY seq`, seq)
      .toArray()
      .map((r) => ({
        seq: Number(r.seq),
        opId: String(r.op_id),
        kind: String(r.kind),
        payload: JSON.parse(String(r.payload)),
      }));
  }

  maxSeq(): number {
    const rows = this.sql.exec(`SELECT MAX(seq) AS m FROM ops`).toArray();
    return Number(rows[0]?.m ?? 0) || 0;
  }

  clear(): number {
    const n = this.maxSeq();
    this.sql.exec(`DELETE FROM ops`);
    // Reset AUTOINCREMENT too, so the rebuilt journal starts at seq 1 and a
    // device holding a stale cursor doesn't skip the new ops.
    this.sql.exec(`DELETE FROM sqlite_sequence WHERE name = 'ops'`);
    return n;
  }
}
