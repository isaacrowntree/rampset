/** A "phone" for the journeys: a browser context with its own virtual passkey
 * authenticator (Face ID, as far as the app can tell) and its own client IP.
 *
 * The IP matters because sign-in is rate limited per client IP — the real
 * limiter runs under wrangler dev — and every phone here comes from
 * localhost. */
import { test as base, expect, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface Phone {
  page: Page;
  context: BrowserContext;
  /** Uncaught exceptions and React hydration errors seen on this phone. */
  errors: string[];
  /** Copy this phone's passkeys onto another — what iCloud Keychain or Google
   * Password Manager does between a lifter's devices. */
  sharePasskeysWith(other: Phone): Promise<void>;
  addCredentials(credentials: unknown[]): Promise<void>;
}

let ip = 0;

async function newPhone(browser: Browser, options: Parameters<Browser["newContext"]>[0]): Promise<Phone> {
  ip++;
  const context = await browser.newContext({
    ...options,
    extraHTTPHeaders: { "cf-connecting-ip": `10.9.${Math.floor(ip / 250)}.${ip % 250}` },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat/i.test(m.text())) errors.push(m.text());
  });
  const cdp: CDPSession = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  return {
    page,
    context,
    errors,
    async sharePasskeysWith(other) {
      const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
      await other.addCredentials(credentials);
    },
    async addCredentials(credentials) {
      for (const credential of credentials) {
        await cdp.send("WebAuthn.addCredential", { authenticatorId, credential: credential as never });
      }
    },
  };
}

export const test = base.extend<{ phone: () => Promise<Phone> }>({
  // `provide`, not `use`: the React hooks lint rule reads `use` as a hook.
  phone: async ({ browser, contextOptions }, provide) => {
    const phones: Phone[] = [];
    await provide(async () => {
      const p = await newPhone(browser, contextOptions);
      phones.push(p);
      return p;
    });
    for (const p of phones) await p.context.close();
    // Whatever the journey checked, the app must not have thrown on the way.
    expect(phones.flatMap((p) => p.errors)).toEqual([]);
  },
});

export { expect };

/** The code in the newest email sent since `since` (ms). Locally the email
 * binding writes each message to .wrangler/tmp/email/<run>/email-text/. The
 * journeys run one at a time, so the newest is ours. */
export async function emailedCode(since: number): Promise<string> {
  const root = path.resolve(".wrangler/tmp/email");
  for (let tries = 0; tries < 50; tries++) {
    const files = (() => {
      try {
        return readdirSync(root, { recursive: true, withFileTypes: true })
          .filter((d) => d.isFile() && d.parentPath.endsWith("email-text"))
          .map((d) => path.join(d.parentPath, d.name))
          .filter((f) => statSync(f).mtimeMs >= since);
      } catch {
        return [];
      }
    })().sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    const code = files.length ? /Your code is (\d{6})/.exec(readFileSync(files[0], "utf8"))?.[1] : undefined;
    if (code) return code;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("No code was emailed");
}
