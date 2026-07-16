# Contributing to Rampset

Thanks for taking a look. Rampset is meant to be *yours* — bend it, fork it,
or send changes back. This is a small project with a simple bar: keep it
tested, keep it honest.

## Getting set up

```bash
npm install
cp .env.example .env.local   # add a lifter or two
npm run dev                  # http://localhost:3000
```

## The workflow

Everything is test-driven, and the checks that run in CI are the ones to run
locally before you push:

```bash
npm test          # vitest — engines, store, sync, components
npm run typecheck # tsc --noEmit
npm run lint      # eslint (flat config)
```

- **The engines are the heart of it.** Progression, deload, Madcow ramps,
  routine prefill, plate math, e1RM, and PR detection live as pure functions in
  `src/lib/`, each with a `.test.ts` beside it. Changing behaviour? Write a
  failing test first, then make it pass.
- **New programs are data**, not code — add them to
  `src/lib/programTemplates.ts` and they show up in the picker automatically.
- **UI** follows the existing components: OLED + IWF-plate palette, per-user
  light/dark skins, everything works offline.

## Pull requests

- Keep PRs focused; one change per PR.
- All three checks (`test`, `typecheck`, `lint`) must pass — CI enforces them.
- Describe what changed and why. If it changes training behaviour, say what a
  test now proves.

## Reporting bugs / ideas

Open an issue with what you expected, what happened, and steps to reproduce.
Feature ideas are welcome too — but a small, tested PR is the fastest path.

By contributing you agree your work is released under the project's
[MIT license](LICENSE).
