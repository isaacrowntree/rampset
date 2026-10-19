<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/rampset-logo-light.svg">
    <img src="docs/assets/rampset-logo.svg" alt="Rampset" height="56">
  </picture>
</p>

<p align="center">
  <strong>The barbell strength log you actually own.</strong><br>
  Open-source · offline-first · self-hosted · MIT
</p>

<p align="center">
  <a href="https://github.com/isaacrowntree/rampset/actions/workflows/ci.yml"><img src="https://github.com/isaacrowntree/rampset/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/PWA-offline--first-3d6dff.svg" alt="Offline-first PWA">
</p>

---

Rampset is a training log for people who lift a barbell. Guided **5×5** and
**Madcow** programs with automatic progression, freeform routines, per-side
plate math, ramped warm-ups, and personal-record tracking — as an installable
PWA you run yourself.

It's **yours**: reshape any program, rewrite the progression engines or add
your own, keep every rep on your device, and export it all whenever. No
subscription, no password to lose, no roadmap that abandons you.

**Website & guide → https://isaacrowntree.github.io/rampset**

<p align="center">
  <img src="docs/assets/shots/u1-workout.png" alt="Program workout" width="220">
  <img src="docs/assets/shots/mc-fri-intensity.png" alt="Madcow ramp" width="220">
  <img src="docs/assets/shots/u1-progress.png" alt="Progress and PRs" width="220">
</p>

## What's in it

- **Program mode** — StrongLifts-style 5×5 (A/B, Plus, Lite, Mini, Ultra, Ultra
  Max). Tap-cycle plate circles, warm-up ramps, per-side plate math, automatic
  +weight on success and deload after repeated fails.
- **Madcow mode** — weekly ramped 5×5: heavy / light / intensity days, a Friday
  PR set that sets next week's top, back-off sets.
- **Routine mode** — freeform Strong-style set rows, every set prefilled from
  your last session.
- **Progress** — estimated 1RM, top set, volume and reps per lift, with a
  personal-record ★ the moment you beat an all-time best; body-weight trend.
- **History** — a calendar of every session plus recaps.
  Export gives everything back.
- **Offline-first** — IndexedDB on the device is the source of truth; the whole
  app works with no network (gym dead zones, airplane mode), and screen wake-lock
  keeps it on during a workout.

## Run it locally

```bash
git clone https://github.com/isaacrowntree/rampset
cd rampset
npm install
npm run dev                    # → http://localhost:3000, device-only (no accounts)
npm run preview                # → http://localhost:8787, the real worker: accounts, sync
```

`npm run dev` is plain Next.js, which can't run Durable Objects — so the app
offers **Start on this device**, a local-only account with no sync. Use
`npm run preview` to work on sign-in and sync: it builds the worker and serves
it under `wrangler dev`, with the Durable Objects, R2, rate limits and email
running locally (sent emails are written under `.wrangler/tmp/email/`).

## Tests

```bash
npm test                       # unit + component (Vitest, jsdom)
npm run test:integration       # the Auth Durable Object on real workerd SQLite
npm run test:e2e               # the whole app in Chromium against the built worker
```

The end-to-end suite (`e2e/`) is the one to trust. It drives real journeys —
signing up with a passkey (Chrome's virtual authenticator), training 5×5,
Madcow and a custom routine, correcting history, importing from StrongLifts,
recovering a lost phone by email, settings, deleting an account — against the
built worker with nothing mocked. The core sync journey runs **online,
offline, on a flappy connection and on a slow one**, and checks a workout
reaches the second phone exactly once.

## Self-host on Cloudflare

Rampset deploys to Cloudflare Workers via the OpenNext adapter. Anyone can
create an account on your instance: a **passkey** (Face ID, a fingerprint) is
the login, and an optional **recovery email** gets them back in if they lose
every device. Accounts, passkeys and sessions live in a Durable Object — there
is nothing to configure in the dashboard.

```bash
npm run deploy                 # opennextjs-cloudflare build && deploy
```

Then, once deployed:

1. Set your **Cloudflare account id** in `wrangler.jsonc` (replace the
   placeholder) or export `CLOUDFLARE_ACCOUNT_ID`.
2. Create the **R2 bucket** the `BACKUPS` binding points at (for cloud backups).
3. **Recovery email** (optional): set `EMAIL_FROM` in `wrangler.jsonc` to an
   address on a domain onboarded to Cloudflare Email Sending
   (`npx wrangler email sending enable <domain>`). Without it, the app simply
   doesn't offer recovery by email.
4. **Bot protection** (optional): create a Turnstile widget and set the
   `TURNSTILE_SITE_KEY` var and `TURNSTILE_SECRET_KEY` secret. Sign-up and
   recovery then ask for a Turnstile check.

Sign-in and email routes are rate limited per client IP, and sync/backup per
account (the `ratelimits` bindings). The journal takes a big backlog in batches
of 100 ops / 1 MB; a backup is capped at 10 MB, with one rollback snapshot kept
per hour.

**What it costs:** Workers and Durable Objects are free at household scale, and
there's no KV/cache to configure. The one paid gate is **R2** — the app's
backups sit comfortably inside R2's 10 GB free tier, but Cloudflare requires a
**payment method on file to enable R2** (you won't be charged under the free
limits). Prefer no card at all? Remove the `BACKUPS` R2 binding from
`wrangler.jsonc` — sync still works, and **Settings → Download backup** gives
you a complete file whenever you want.

## Your data

Everything is on the phone first. **Settings → Your data** downloads a full
backup file, restores one (from any account — this is how you move to a new
one), exports a CSV, and **imports your history from StrongLifts or Strong**.
A phone from before accounts keeps its lifters' history untouched; **Settings →
From before accounts** moves each one into an account when you're ready.
Programs are templates in the repo (`src/lib/programTemplates.ts`); choose
StrongLifts 5×5, Madcow, or a **custom routine** you build in the Program tab.

## Architecture

- **Next.js 16 App Router**, all screens client components.
- **IndexedDB (Dexie)** is the on-device source of truth — fully functional
  offline. Cross-device **sync** (a per-account SQLite Durable Object that
  orders each account's ops, via [durable-sync](https://github.com/isaacrowntree/durable-sync)),
  **accounts** (passkeys + email recovery in an Auth Durable Object), and
  **backups** (R2 snapshots) via Cloudflare Workers.
- **Engines** are pure, unit-tested functions in `src/lib/`: linear progression
  + deload, Madcow ramps, routine prefill, plate-per-side math, Epley e1RM,
  PR detection. Editing them is the point — start there.
- **PWA**: manifest + service worker (network-first shell, offline fallback),
  installable to the home screen.
- **Design**: OLED black + IWF plate palette, per-user light/dark skins.

## Contributing & making it yours

Fork it and go. The progression logic lives in `src/lib/` (each engine has a
`.test.ts` next to it — write a failing test, make it pass). New programs are
data in `src/lib/programTemplates.ts`. It's MIT licensed: build the training app
*you* want, closed or open, and keep your data.

## License

[MIT](LICENSE). Rampset is an independent open-source project. "StrongLifts" and
"Madcow" refer to well-known training methods and are not affiliated with or
endorsed by this project.
