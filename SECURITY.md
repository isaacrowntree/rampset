# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's **[private vulnerability reporting](https://github.com/isaacrowntree/rampset/security/advisories/new)**
(Security → Report a vulnerability) to reach the maintainer privately. Include
what you found, how to reproduce it, and the impact. You'll get a response as
soon as reasonably possible.

## Scope

Rampset is a **self-hosted** app: each operator runs their own instance on
their own Cloudflare account and sets their own secrets. Anyone can create an
account on an instance; passkeys are the login, with an optional recovery
email. That means:

- **In scope:** flaws in this codebase — e.g. reading or writing another
  account's data, a way around a passkey or a recovery code, session or
  cookie weaknesses, a broken sync/backup authorization check, or an
  XSS/injection in the app itself.
- **Out of scope / operator responsibility:** your Worker secrets and vars,
  your email-sending domain, your Turnstile and rate-limit settings, and
  anything specific to how you deployed it. Never commit secrets — `.dev.vars`
  is gitignored for this reason.

## Supported versions

This is a young project; fixes land on `main`. Please test against the latest
`main` before reporting.
