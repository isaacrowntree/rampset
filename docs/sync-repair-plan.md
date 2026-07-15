# Sync repair — findings and remaining work

Written after a production incident (2026-07-14/15): a workout finished in the browser view never
reached the journal or R2, and was ultimately lost. Ten review passes plus browser reproduction
against a production build. Several of this document's earlier conclusions were wrong and are
recorded as such, because the wrong turns are the useful part.

## What actually happened

`Sheet` pushes a history entry on mount (`src/components/Sheet.tsx`) so the back gesture closes it,
and popped it unconditionally on unmount. But `router.replace("/history")` **overwrites** that entry
— so the pop walked the user back to `/workout`.

Reproduced against `next build` + `next start`:

| | pre-fix | post-fix |
| --- | --- | --- |
| lands on | `/workout`, timer running | `/history` |
| congrats | `justFinished` still in sessionStorage — `/history` never mounted | shown |
| pin | `null` | cleared, navigated |

The workout *was* finished and *was* in the outbox. With the pin already cleared, the next mount
fell through to `nextProgramDay()` + `startWorkout()` — **the next workout**. That is the reported
symptom, and it is how a finished workout ends up stranded on one device.

Compounding it: `flushOutbox` drained the outbox whenever `res.ok` was true, and an expired
Cloudflare Access session returns its login page as a same-origin **200**. So the queue was deleted
without the journal ever receiving the ops.

## Fixed (each with a test that failed first)

- `Sheet` takes `keepHistoryOnUnmount`; the workout screen sets it before any `router.replace`.
- `flushOutbox` validates the response body shape before draining; both sync calls send
  `X-Requested-With: XMLHttpRequest` so Access returns 401 rather than a 200 login page.
- `completeWorkout` survives a failed enqueue instead of stranding the flow.
- `restoreBackup` refuses a file whose `userId` differs from the active user. It previously wiped
  the active user, grafted the foreign rows in verbatim, and **returned a success summary**.
- `pullAndApply` steps over a malformed op instead of pinning the cursor forever.
- `startWorkout` adopts today's open workout for the same day instead of minting a second row.
  Verified in-browser: one "Start workout" click previously created **two** rows.
- `SyncEngine` drives sync from every foregrounding (`visibilitychange`, `pageshow`, `focus`,
  `online`, 5-min visible-only poll), single-flighted and throttled — replacing the single
  once-per-mount sync in `UserContext`.

**Push-only during an active workout.** `applyOp` writes `programExercises.workingWeightKg`, and
`finishWorkout` reads it back (`src/db/session.ts`) to decide deloads — a mid-session pull can
silently drop a 5×5 to 3×5.

## Wrong turns (do not retry)

- **"Normalize `userId` on apply."** Premise was "the DO namespace *is* the identity". False: the
  AvatarSwitcher decouples the app-user from the Access session, and R2 confirms two real users
  share the deployment. The `userId` check is the only thing keeping them apart in an append-only
  log — and `applyOp` dedupes on workout id alone, so the first avatar to pull would claim the
  whole journal permanently.
- **"Publish `latest.json` only when caught up."** `flushOutbox` never advances the cursor, so the
  device that just finished a workout is by construction never caught up — `latest.json` would
  freeze. The invariant is also false: program structure isn't journaled, so a caught-up device
  still clobbers it.
- **A `syncedAt` column for backfill.** It rides into `exportBackup`, so importing a backup marks
  everything already-synced and the backfill silently no-ops. IndexedDB indexes are sparse, so
  `syncedAt === undefined` is exactly what an index cannot find. Derive from journal opIds instead.
- **Tombstones for the fake workout.** A tombstone removes the history row but leaves the
  `workingWeightKg` it already advanced, which `applyOp` re-propagates. Fixing the data is both
  cheaper and more complete.

## Test traps found the hard way

Two tests passed for the wrong reason before being fixed:

- Injecting a throwing `enqueue` passed because the injection seam didn't exist — the stub was
  ignored and the real enqueue ran.
- A cross-user `restoreBackup` test passes on an unrelated `ConstraintError` when the fixture's ids
  collide with the seed. It must use **non-colliding** ids to fail for the right reason.

## Remaining

- **R2 `latest.json` is still last-writer-wins.** The fix is serialized merge-on-write through the
  DO (which is already per-identity), not a client-side gate.
- **The journal holds 4 ops against ~1275 workouts.** New workouts converge; history does not,
  until a one-time convergence. Bootstrap still depends on R2.
- **Sync status UI** — last synced, pending count, last error. Every failure path is still silent.
- **Identity guard** — refuse to sync/backup when the selected avatar's email ≠ the Access email.
  Today, backing up while switched to another avatar writes their DB to *your* `latest.json`.
- **Pagination** — `handlePull` has no LIMIT and `flushOutbox` posts every row in one request.
