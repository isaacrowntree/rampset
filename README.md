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

---

Rampset is a training log for people who lift a barbell. Guided **5×5** and
**Madcow** programs with automatic progression, freeform routines, per-side
plate math, ramped warm-ups, and personal-record tracking — as an installable
PWA you run yourself.

It's **yours**: reshape any program, rewrite the progression engines or add
your own, keep every rep on your device, and export it all whenever. No
subscription, no account to lose, no roadmap that abandons you.

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
- **Import** — StrongLifts and Strong CSV exports (auto-detected, idempotent).
  Export gives everything back.
- **Offline-first** — IndexedDB on the device is the source of truth; the whole
  app works with no network (gym dead zones, airplane mode), and screen wake-lock
  keeps it on during a workout.

## Run it locally

```bash
git clone https://github.com/isaacrowntree/rampset
cd rampset
npm install
cp .env.example .env.local     # then edit: your lifters, units, starting weights
npm run dev                    # → http://localhost:3000
npm test                       # vitest — the engines, importers, store, components
```

## Self-host on Cloudflare

Rampset deploys to Cloudflare Workers via the OpenNext adapter, and uses
**Cloudflare Access** (a free zero-trust login) as its auth — so only the emails
you allow can get in, with no passwords for you to manage.

```bash
npm run deploy                 # opennextjs-cloudflare build && deploy
```

Then, once deployed:

1. Set your **Cloudflare account id** in `wrangler.jsonc` (replace the
   placeholder) or export `CLOUDFLARE_ACCOUNT_ID`.
2. In the Cloudflare dashboard, add an **Access** application in front of your
   Worker's URL and allow your lifters' emails (email one-time-code or Google).
   That's your login — each profile is keyed to the authenticated Access email.
3. Create the **R2 bucket** the `BACKUPS` binding points at (for cloud backups).

**What it costs:** Workers and Cloudflare Access are free for a household
(Access is free up to 50 users), and there's no KV/cache to configure. The one
paid gate is **R2** — the app's backups sit comfortably inside R2's 10 GB free
tier, but Cloudflare requires a **payment method on file to enable R2** (you
won't be charged under the free limits). Prefer no card at all? Remove the
`BACKUPS` R2 binding from `wrangler.jsonc` — the app is fully offline-first on
local IndexedDB and **Settings → Export** gives you a complete CSV backup
whenever you want.

## Configuration — no personal data in the repo

Lifters are defined entirely by an env var (`.env.local`, gitignored). See
[`.env.example`](.env.example) for the shape: `id`, `name`, `email`, `accent`
(`blue` | `green`), `unit` (`kg` | `lb`), program `template`, and optional
starting working weights. The committed code carries only generic program
templates. Switch lifters with the avatar in the header (or Settings → Account).

## Architecture

- **Next.js 16 App Router**, all screens client components.
- **IndexedDB (Dexie)** is the on-device source of truth — fully functional
  offline. Optional cloud backups via Cloudflare Workers + R2.
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
