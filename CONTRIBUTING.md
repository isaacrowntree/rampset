# Contributing to Rampset

Thanks for taking a look. Rampset is meant to be *yours* — bend it, fork it,
or send changes back. This is a small project with a simple bar: keep it
tested, keep it honest.

## Getting set up

```bash
npm install
npm run dev                  # http://localhost:3000 — device-only, no accounts
npm run preview              # http://localhost:8787 — the real worker: passkeys, sync
```

## The workflow

Test-first, and integration-first: a change starts as a failing test of what
a lifter would see, and the end-to-end suite is the one that proves it.

```bash
npm run test:e2e         # Playwright — the whole app against the built worker
npm run test:integration # the Auth Durable Object on real workerd SQLite
npm test                 # vitest — engines, store, sync, components
npm run typecheck        # tsc --noEmit
npm run lint             # eslint (flat config)
```

- **Journeys live in `e2e/`.** Each phone is a browser context with its own
  virtual passkey authenticator (`e2e/fixtures.ts`); `e2e/network.ts` puts it
  online, offline, on a flappy connection or a slow one. Nothing is mocked:
  Durable Objects, R2, rate limits and email run locally under `wrangler dev`.
- **The engines are the heart of it.** Progression, deload, Madcow ramps,
  routine prefill, plate math, e1RM, and PR detection live as pure functions in
  `src/lib/`, each with a `.test.ts` beside it — dense logic earns unit tests.
- **New programs are data**, not code — add them to
  `src/lib/programTemplates.ts` and they show up in the picker automatically.
- **UI** follows the existing components: OLED + IWF-plate palette, per-user
  light/dark skins, everything works offline.

## Pull requests

- Keep PRs focused; one change per PR.
- Every check above must pass — CI runs them all, end-to-end included.
- Describe what changed and why. If it changes training behaviour, say what a
  test now proves.

## Reporting bugs / ideas

Open an issue with what you expected, what happened, and steps to reproduce.
Feature ideas are welcome too — but a small, tested PR is the fastest path.

By contributing you agree your work is released under the project's
[MIT license](LICENSE).
