# LiftLog

Offline-first training PWA for a small household of lifters — built for two
people with completely different training styles, sharing one engine.
MIT licensed. Built TDD: 65 tests across the engines, importers, store, and
components.

| Mode | For | Workout UI | Progression |
|---|---|---|---|
| **Program** | 5×5-style linear progression | Tap-cycle plate circles, warmup ramps, per-side plate math | Automatic: +kg per successful workout, deload after repeated fails |
| **Routine** | Freeform training (Strong-style) | Set rows — SET · PREVIOUS · KG · REPS · ✓ — with timed and bodyweight sets | Manual: every set prefills from your last session |

Same schema, same logging store, same history/progress screens. Mode is a
per-program flag. Each user gets their own accent color from the IWF plate
palette (20kg blue, 10kg green).

## Run

```bash
npm install
cp .env.example .env.local   # then edit: your names, emails, starting weights
npm run dev                  # http://localhost:3000
npm test                     # vitest
npm run build                # production build
```

## Configuration — no personal data in the repo

Users are defined entirely by the `NEXT_PUBLIC_LIFTLOG_USERS` env var in
`.env.local` (gitignored). See `.env.example` for the shape: id, name, email,
accent, unit, program template, and optional starting working weights. The
committed code contains only generic program templates.

Switch users with the avatar in the header (or Settings → Account).

## Import history

Settings → Import CSV accepts two dialects, auto-detected:

- **StrongLifts** export (wide format: one row per exercise, `Set N` columns)
- **Strong** export (long format: one row per set, interleaved Rest Timer
  rows). Exercise names are normalized and merged; rest-timer rows are mined
  for per-exercise rest defaults; timed and bodyweight sets are classified.

Import is idempotent per (date + day label). Export CSV gives everything back.

## Architecture

- **Next.js 16 App Router**, all screens client components
- **IndexedDB (Dexie)** is the on-device source of truth — fully functional
  with no network (gym dead zones, airplane mode)
- **Engines** are pure functions in `src/lib/`: linear progression + deload,
  routine prefill, plate-per-side math, warmup ramps, Epley e1RM
- **PWA**: manifest + service worker (network-first shell with offline
  fallback), screen wake-lock during workouts
- Design: OLED black, IWF plate palette, Archivo / Lexend / IBM Plex Mono

## Layout

```
app/                     routes (home, workout, history, progress, program, settings)
src/config/              user config loader (env-driven; no PII in code)
src/lib/                 pure engines + CSV importers (+ tests)
src/db/                  Dexie schema, seed templates, session logic, import store (+ tests)
src/components/          shell, nav, SetPlate (program), SetRow (routine), workout screens
public/                  manifest, icons, service worker
```

## Deploying

Designed to sit behind an authenticating proxy (e.g. Cloudflare Access) that
maps an authenticated email to a configured user; data stays client-side.
A server sync layer (Cloudflare D1 + R2 backups) is a planned milestone.
