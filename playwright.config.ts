/** End-to-end: the whole app in a real browser against the real Worker.
 *
 * `npm run test:e2e` builds with OpenNext, then serves the built worker under
 * `wrangler dev` — Durable Objects (Auth, SyncJournal), R2, rate limits and
 * the email binding all run locally on their real implementations, with a
 * fresh state directory per run. Passkeys come from Chrome's virtual
 * authenticator (see e2e/fixtures.ts). Nothing is mocked. */
import { defineConfig, devices } from "@playwright/test";

// E2E_PORT: run beside another wrangler dev that already holds the default.
const PORT = Number(process.env.E2E_PORT ?? 8788);

export default defineConfig({
  testDir: "e2e",
  // One server, one shared Auth DO: journeys run one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["iPhone 15"],
    // Virtual authenticators are a Chromium (CDP) feature.
    browserName: "chromium",
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    // --local-upstream: without it wrangler dev presents every request as
    // arriving on the production route's host, and passkeys bind to that
    // domain instead of localhost.
    command: `rm -rf .wrangler/e2e-state .wrangler/tmp/email && npx wrangler dev --port ${PORT} --persist-to .wrangler/e2e-state --local-upstream localhost:${PORT}`,
    url: `http://localhost:${PORT}/api/auth/config`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
