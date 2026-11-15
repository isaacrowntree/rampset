/** Opt-in integration suite: sign-in against a real Auth Durable Object on the
 * SQLite that ships. `bun run test` never runs it — it's `bun run
 * test:integration`, because it boots workerd and is far slower. */
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import path from "node:path";

export default defineConfig({
  plugins: [
    cloudflareTest({
      isolatedStorage: true,
      wrangler: { configPath: "./test/integration/wrangler.jsonc" },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    include: ["test/integration/**/*.test.ts"],
  },
});
