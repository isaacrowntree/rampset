> **SUPERSEDED by `full-plan.md`.** Its headline fix was harmful — see there.

# Plan v2: fix what's proven, delete what's dead, ship what's built

Supersedes `checkpoint-migration-plan.md` (phases 2–5 are **wrong** — see below).
This is v2: **v1's headline fix was harmful** and three reviewers caught it.

## The generative mistake, written down so it stops repeating

Twice now a plan has been wrong the same way: **a premise asserted from memory
instead of read from the repo.** v1 of the checkpoint plan assumed apply was
deterministic (it wasn't), and budgeted ~150 lines for a library that already
existed at 1181. v1 of *this* plan proposed a fix without checking what else
writes the field it touches.

> **Rule: before proposing a design, grep for the thing it assumes exists.**

## 1. `flushOutbox` bypasses the identity gate — NEW, verified, worst item here

The gate is on `cloudBackup.ts:24` and `syncEngine.ts:110`. But `finishFlow.ts:45`
calls `flushOutbox` **directly**, and `sync.ts`'s `flushOutbox` has no gate.

Switch to the other avatar and finish a workout:
`flushOutbox(B.id, B.email)` → `/api/sync` routes by the **Access** email
(`app/api/sync/route.ts:17-30`) → **A's journal**. It returns a valid
`{seq, accepted}`, so `isJournalAck` passes and `sync.ts:163` **drains B's
outbox**. `applyOp:179` then correctly refuses to adopt it, so it's junk in A's
append-only log — and B's only copy is gone.

**This is the incident, verbatim: queue drained, journal never got it.** On the
code path that runs after every single workout.

**Test first:** `mayWriteAs` false → `flushOutbox` must not POST and must not
drain.
**Fix:** the gate belongs *in* `flushOutbox`, not in its callers.

## 2. Replay leaves stale weights — proven, but v1's fix was HARMFUL

Reproduced: `applyOp(op1); applyOp(op2); applyOp(op1); applyOp(op2)` → **25,
expected 27.5**. op1 (`deleteWorkout`) re-applies its rollback on replay; op2
(`finishedWorkout`) early-returns because the workout exists, skipping its own
correction.

**v1 said: "move the weights loop out of the early return." That is harmful.**
Three reviewers, independently:

`workingWeightKg` has three writers that emit **no op at all** — the layoff
`DeloadButton` (`app/page.tsx:282`, rewrites *every* slot), manual weight edits
(`program/page.tsx:325`), and mid-workout edits
(`ProgressionWorkout.tsx:412`). v1's own document says *"the journal cannot
represent an edit"* — and then proposed a fix that depends on the opposite.

With v1's fix, every historical op re-asserts its snapshot on replay, so a
hand edit or a layoff deload is **silently reverted**. The bug corrupts one
slot; the fix corrupts every slot, on the same trigger. It also reintroduces a
wrong turn `sync-repair-plan.md` already documented (tombstone + weights), and
**the suite would ship it green** — `sync.test.ts:263` passes a delete payload
with *no weights* and never asserts `workingWeightKg`.

**Also: v1's reachability argument was wrong.** "iOS evicts localStorage and
IndexedDB independently" — ITP evicts script-writable storage as a unit, and
home-screen PWAs are exempt. The bug is reachable for a better reason:
**`autoRestoreIfEmpty` restores from R2 and never sets the cursor**
(`autoRestore.ts:11`), so every fresh device replays the whole journal from 0
onto a snapshot that already reflects it. And the epoch path replays by design
(`sync.ts:277`) — which **already ran in production** (`ee5e6df`).

**Correct fix:** gate the *delete* path's weights on the tombstone not already
existing. The tombstone is written in the same transaction as the weights
(`sync.ts:218`, `sync.ts:223`), so tombstone-exists ⟺ this device already
applied this delete. Atomic, no window. The finish path is left alone —
workout-exists is already its correct first-sight signal.

**Tests first (three):**
- the repro → 27.5
- **a replay must not wipe an un-journalled program edit** (passes today, fails
  under v1's fix)
- a create op carrying weights arriving *after* a tombstone must not advance
  the weight (the gap `sync.test.ts:263` leaves open)

## 3. Sync status lies in two more places

- `SyncStatusRow.tsx:69` — `db.outbox.count()` unscoped while `flushOutbox`
  scopes `where({ userId })`. Two avatars → counts the other user's rows.
- **`SYNC_STATE_KEY` is a single global key** (`syncEngine.ts:42`) while cursor
  and epoch are per-user. User B reads **"Synced 2 minutes ago"** from user A's
  state, having never synced. v1 fixed the count and left the headline lying.

**Test first:** two users' rows → user-1's status reports only user-1's.

## 4. Delete the CSV import — 633 lines

Verified exactly by applying it in a throwaway worktree: suite green, `tsc`
names **exactly three errors**, all in `app/settings/page.tsx:8-10` — a
compiler-proven closed graph.

| file | lines |
|---|---|
| `src/lib/importers/stronglifts.ts` / `strong.ts` / `csv.ts` / `types.ts` | 276 |
| `src/db/importStore.ts` | 116 |
| `src/lib/importers/{strong,stronglifts,realfiles}.test.ts` | 171 |
| **`src/db/importStore.test.ts`** (v1 never named it) | 70 |
| **total** | **633** |

Real diff is **752** including `fixes.test.ts` (−48) and `settings/page.tsx`
(−71). Suite 303 → 280.

Also update `README.md:64`, `CONTRIBUTING.md:21`, `ROADMAP.md:6` — all three
still advertise the importers, so the repo would otherwise start lying.

**The CSV is not the recovery path.** The JSON baseline is strictly better
(`backups/isaac@rowntree.me/2026-07-03T02-38-07.json`, 1270 workouts, permanent
prefix) — re-importing regenerates ids, synthesizes timestamps, and carries no
program structure or weights. The raw CSV also still exists at
`~/Downloads/Stronglifts20260702.csv`.

## 5. Publish `durable-sync` — v1 over-corrected into abandonment

v1 said park it unpublished. That conflates two independent things: **publishing
and Rampset-consuming-it.** The risk ("its first production user is the
maintainer's own irreplaceable data") comes from integration — **which is
already cut**. An unpublished repo with one commit delivers nothing, and
quietly drops what was asked for.

Fix the three confirmed extraction bugs first — the README currently **ships
two of them as recommended usage**:
- missing `getServerSnapshot`; `README.md:146` shows
  `useSyncExternalStore(..., () => ({}))`, the exact infinite-loop bug the
  library warns about elsewhere
- `start()` calls `document.addEventListener` unguarded, and `README.md:113`
  calls it at module scope
- `transport.ts:161` writes `epoch: undefined` when a reply omits it, wiping a
  known epoch — Rampset's `sync.ts:277` guards this, so the extraction
  *regressed* it

Then document the single-tenant constraint (a limit, not a blocker) and publish
0.1.0 with: *"Extracted from Rampset, which runs this design in production; not
yet consumed by it."* Honest **and** shipped.

## Known-broken, not fixing now (documented, not forgotten)

Reachable today, all found by review, none urgent for a 2-device setup:

- **Program structure has no pull channel at all.** `autoRestoreIfEmpty` only
  runs at `workoutCount === 0`, so once both views have data, program structure
  never moves between them. A device that merely *trained* republishes its whole
  DB and erases the other's program edit via `{...incoming}`
  (`backupStore.ts:71`). Cheapest honest fix: `updatedAt` on `programs`, and
  take the incoming subtree only if it's newer. ~10 lines. **Next thing worth
  doing after this plan.**
- `unionById`'s *"incoming is the fresher edit"* (`backupStore.ts:39`) is false
  — incoming is merely *later to publish*. Set corrections, notes, and body
  weight get reverted by a peer's backup.
- `clearSet` deletions can't propagate: union can't subtract, and the tombstone
  authority is workouts-only.
- `DeloadButton` (`app/page.tsx:282`) calls neither `scheduleBackup` nor sync.
- Rest-timer default is in `db.settings`, which `exportBackup` doesn't include.
- The identity gate fails **open** when `/api/me` times out (2s,
  `UserContext.tsx:49`), and fails **silently** (`syncEngine.ts:110` returns
  before recording state).

## Order

1. `flushOutbox` identity gate — loses data, hot path.
2. Replay weights — the *delete*-path fix, with all three tests.
3. Sync status scoping (count + state key).
4. Delete CSV import + doc updates.
5. `durable-sync`: 3 fixes, README, publish 0.1.0.

## Still cut

Checkpoints, importing the library into Rampset, migrating the 1270, demoting
R2, pagination, compaction. `checkpoint-migration-plan.md` needs a SUPERSEDED
banner so nobody reads it cold.
