# Roadmap

## Done (v0 → now)

Two-mode engine (program/routine) · plate-circle + Strong-row workout UIs ·
CSV importers (both dialects, idempotent, real-export verified) — REMOVED 2026-07-16, migration complete · 35 review
findings fixed · graduated comeback deload (2wk −10 / 4wk −20 / 8wk −30) ·
SL regime alignment (warmup protocol incl. floor pulls + empty-bar sets,
fail rest 5:00, configurable success rest, deload after 3 fails) · rest
timer (wall-clock, bell + vibration) · body-weight carry-forward · R2
snapshots (auto after finish, auto-restore on fresh devices) · per-user
SyncJournal Durable Object (offline outbox, pull-on-load) · Access identity
scoping + runtime user config via worker secret · Liquid Glass UI ·
PWA (icons, SW, wake lock) · 134 tests.

## 1 — React modernization ("you might not need an effect")

Audit of all 8 effects: 6 are legitimate external-system syncs (wake lock,
visibilitychange, service worker, Escape/focus in the dialog, app bootstrap,
session setup with cancellation). Two violate the rule and get fixed:

- [x] **BodyWeightField carry-forward effect → event-time.** Writing the
      carried weight in an effect is derived-data-in-lifecycle. Move it to
      `startWorkout()`: the new workout row is born with the last known
      body weight. Component becomes a dumb input; tests move to session.
- [x] **RoutineWorkout hydration effect → live derivation.** Rows mirror
      Dexie into useState then reconcile on mount. ProgressionWorkout
      already does this right (useLiveQuery ≈ useSyncExternalStore).
      Refactor: `done`/persisted values derive live from the DB; useState
      holds only uncommitted drafts (weight/reps being typed). Deletes the
      hydration effect and the StrictMode double-persist worry wholesale.

## 2 — Written-program purity (decisions, then small builds)

- [x] **Linked squat progression (opt-in).** The written 5×5 progresses
      squat every workout as ONE chain; the SL app (and ours) tracks per-day
      slots — which is why A=25/B=27.5 diverged during knee rehab. Add
      `linkedExerciseIds` per program: on finish, a success advances every
      slot of that exercise across days. Ship OFF by default; turning it on
      snaps all slots to the highest chain. Decision needed: enable once the
      knee-rehab gap closes.
- [x] **Stall protocol (5×5 → 3×5 → 1×5).** After the 2nd deload on an
      exercise, drop prescribed sets to 3×5; after another, 1×5 (deadlift
      already 1×5 → stays). Pure extension of the progression engine +
      `sets` mutation on the program exercise; fully TDD-able.

## 3 — Ops hygiene

- [ ] Workers Builds: set build command `npx opennextjs-cloudflare build`
      (dashboard) — CI deploys are already harmless (runtime config), but
      builds should produce the OpenNext output deliberately.
- [x] Retire `NEXT_PUBLIC_LIFTLOG_USERS` from the build path entirely once
      confident in the worker-secret flow (delete env fallback + .env.local,
      keep dev fallback via .dev.vars).
- [x] R2 lifecycle rule: expire dated snapshots after ~90 days (keep
      latest.json forever).

## Later / only if wanted

- Live push between open devices (SyncJournal already a DO — add
  hibernatable WebSockets, clients subscribe instead of pull-on-load).
- D1 analytics sink (cross-user queries, yearly reviews).
- 3×3 / Madcow-style intermediate templates as config.
