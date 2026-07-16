> **SUPERSEDED — do not follow this. Phases 2–5 are wrong.**
>
> Ten review passes took them apart. The premise ("a checkpoint at seq N is
> canonical if apply is deterministic") is false here: apply is not
> deterministic, and `seq` is a Lamport clock over a *strict subset* of the
> state, because program structure is never journalled. Phase 4 would have
> destroyed every workout edit and the whole program, and propagated the loss
> back into R2.
>
> Kept as a record of a wrong turn — the reasoning in "Why checkpoints" is
> still the clearest statement of what R2 lacks. See `full-plan.md`.

# Plan: extract sync into `durable-sync`, replace R2-as-authority with checkpoints

Written 2026-07-16, after a full off-Cloudflare backup. The goal is to end up
with **less code than we started with** and no store that can silently lose a
workout.

## Safety rules (apply to every phase)

1. **Never delete an R2 object.** Not once, not ever, not "it's redundant". The
   90-day lifecycle rule on `snapshots/` is the only thing permitted to remove
   anything, and it can't touch `backups/`.
2. **Never wipe the journal again** without first writing its ops to R2 under a
   `keep-` key. The journal reset in #12 was safe only because R2 held the
   history; that will stop being true once checkpoints move in.
3. **Additive first.** Every phase writes the new thing and leaves the old one
   in place. Deleting the old path is a separate, later commit, only after the
   new one is proven in production.
4. **No phase touches Silvana's data.** She has 86 workouts, exactly one copy,
   and an empty journal. Anything shared gets tested against her namespace last.

## State at the time of writing (verified, not assumed)

| where | what |
|---|---|
| `backups/isaac@rowntree.me/2026-07-03T02-38-07.json` | **1270 workouts** — the pure StrongLifts import baseline. Permanent. |
| `backups/isaac@rowntree.me/latest.json` | 1274. Does **not** include the restored 2026-07-12 Workout A. |
| journal (`isaac@rowntree.me`) | seq 2: `deleteWorkout` (fake squat), `finishedWorkout` (restored 07-12 A) |
| `backups/.../keep-2026-07-14T13-06-10-preincident.json` | 1275 — pre-cleanup rollback, pinned permanent 2026-07-16 |
| off-Cloudflare | `~/Documents/rampset-backups/2026-07-16/` — 11 files, `SHA256SUMS`, `MANIFEST.md` |

**Current truth = `latest.json` + journal.** Neither alone is complete. The
restored Workout A exists *only* in the journal — a single point of failure
that phase 4 exists to remove.

## Why checkpoints

`latest.json` is already a checkpoint, minus the one thing that makes a
checkpoint work: **a sequence number.** Because it can't say which ops it
reflects, it can't tell a fresh snapshot from a stale one — so we compensated
with union-merge, etag CAS, and borrowing the journal's tombstones as a
deletion authority. ~300 lines existing purely to work around a missing integer.

Give the baseline a `seq` and it collapses: a checkpoint at seq N is canonical,
you accept a higher one and reject a lower one, and the clobber becomes
unrepresentable rather than defended against.

The 1270 imported workouts become the baseline. That is legitimate — a baseline
is allowed to be opaque; it is not required to be derivable from the log.

## Phases

### 1. Delete CSV import — safe, independent, no data touched

521 lines (`importers/stronglifts.ts`, `importers/strong.ts`, `db/importStore.ts`
+ tests) and one Settings row. It was the one-time StrongLifts migration; it ran,
and it's now a footgun — an additive `bulkAdd` that injects junk history if
pointed at the wrong file.

Keep **Export CSV** (portability — the one thing that gets data out entirely) and
the JSON backup/restore. Only *import* is finished.

**Revert:** `git revert`. Nothing else.

### 2. Checkpoints in `durable-sync` — library only, no Rampset data touched

- `PUT /checkpoint { seq, blob }` — reject if `seq` < the stored checkpoint's.
- `GET /checkpoint` → `{ blob, seq }`.
- Blob chunked across rows: **DO limit is 2 MB per row, 10 GB per object**
  (verified). Rampset's snapshot is 4.6 MB, so it spans ~3 rows.
- `pull` gains a **`floor`**: if a client's cursor is below the checkpoint seq it
  cannot catch up from ops alone and must fetch the checkpoint first. This is
  what makes compaction safe.
- Compaction (dropping ops <= checkpoint seq) is **deferred**. It's the one
  irreversible operation in the design; get checkpoints working first.

**Revert:** it's a new package, unpublished. Delete the commit.

### 3. Import `durable-sync` into Rampset — code only, no data migration

Rampset keeps what's actually its own: `applyOp`, `buildFinishedWorkoutOp`, the
tombstone table, the mid-workout pull guard (as `canPull`), the identity gate
(as `canWrite`). The package supplies transport + engine.

This is the phase that proves the API. Nothing has ever consumed it.

**Verify:** full suite, then drive the finish flow in a browser against
`next build` — the same way the Sheet fix was verified, because unit tests
didn't catch that one.

**Revert:** `git revert`. No data has moved.

### 4. Migrate the 1270 into a checkpoint — THE destructive phase

Only this phase touches live data, and it stops at the first surprise.

1. Build the blob from `latest.json` (1274) **+ journal op seq 2** (the restored
   07-12 A) = 1275 workouts. Verify the count before uploading.
2. `PUT /checkpoint { seq: 2, blob }`.
3. **Verify by replay**, not by assertion: point a scratch device at it, restore,
   and assert 1275 workouts, squat A = 27.5, no fake squat.
4. Only then switch `autoRestoreIfEmpty` to read the checkpoint.
5. **R2 stays exactly as it is** — untouched, still written, still readable — for
   at least a week of real use.

**Revert:** `autoRestoreIfEmpty` reads R2 again; the checkpoint is inert. R2 is
unchanged throughout, which is the whole point.

### 5. Demote R2 — only after phase 4 has survived real use

Delete `backupStore.ts`'s merge + CAS, `/tombstones`, and `latest.json` as an
authority. R2 becomes dated, write-only, off-Cloudflare disaster copies that the
app never reads.

**Before this lands:** move the `snapshots/` lifecycle rule or write disaster
copies under `backups/`, or the only remaining off-platform copy starts
expiring at 90 days.

## What this deletes

| | lines |
|---|---|
| CSV import + tests | ~521 |
| `backupStore.ts` merge/CAS + tests | ~300 |
| `/tombstones` route + coupling | ~40 |
| `sync.ts` / `syncEngine.ts` transport (moves to the package) | ~350 |
| **out of Rampset** | **~1200** |
| into `durable-sync` (generic, tested, reusable) | ~150 |

## Known risks

- **The journal becomes load-bearing.** Today R2 holds the history and the
  journal holds 2 ops. After phase 4 the checkpoint is in the DO. DO PITR is on
  by default for 30 days, but it is *in-place restore, not export* — it cannot
  survive namespace deletion. R2 disaster copies stay mandatory.
- **Compaction is irreversible.** Deferred out of this plan deliberately.
- **`latest.json` is not currently complete** (missing the restored Workout A).
  Any phase that reads it must add the journal, or lose that workout again.
- **Silvana's data is untested against all of this.** Her journal is empty and
  her device hasn't backed up since 2026-07-03; she is the case where a
  first-sync-after-a-long-gap gets exercised for real.
