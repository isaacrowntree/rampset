/** The real world behind AuthDeps: Cloudflare bindings, read from the Worker
 * env. Every binding but AUTH is optional — a fresh self-host works with none
 * of them and grows features as they're added. */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { journalFor } from "@/server/journal";
import { deleteBackups, type BackupBucket } from "@/server/backupStore";
import { realWebAuthn, type AuthDeps } from "./handlers";
import { sameOrigin, sessionUser } from "./session";
import { authStoreFrom, type AuthApi, type AuthNamespace } from "./stub";
import type { CodePurpose } from "./store";

interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

interface EmailBinding {
  send(message: {
    to: string;
    from: { email: string; name: string };
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

interface AuthEnv {
  AUTH?: AuthNamespace;
  EMAIL?: EmailBinding;
  /** The From address for codes, e.g. noreply@your-domain. Its domain must be
   * onboarded to Cloudflare Email Sending. */
  EMAIL_FROM?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  AUTH_LIMITER?: RateLimiter;
  API_LIMITER?: RateLimiter;
  BACKUPS?: BackupBucket;
}

const dev = process.env.NODE_ENV === "development";

function env(): AuthEnv {
  return getCloudflareContext().env as AuthEnv;
}

function authStore(): AuthApi | null {
  const ns = env().AUTH;
  return ns ? authStoreFrom(ns) : null;
}

export function authDeps(): AuthDeps | null {
  const store = authStore();
  if (!store) return null;
  const e = env();

  return {
    store,
    now: Date.now,
    dev,
    webauthn: realWebAuthn,
    sendCode: e.EMAIL && e.EMAIL_FROM ? emailSender(e.EMAIL, e.EMAIL_FROM) : undefined,
    turnstile:
      e.TURNSTILE_SITE_KEY && e.TURNSTILE_SECRET_KEY
        ? { siteKey: e.TURNSTILE_SITE_KEY, verify: turnstileVerifier(e.TURNSTILE_SECRET_KEY) }
        : undefined,
    rateLimit: e.AUTH_LIMITER ? limiter(e.AUTH_LIMITER) : undefined,
    deleteUserData: async (userId) => {
      await journalFor(userId)?.reset();
      if (e.BACKUPS) await deleteBackups(e.BACKUPS, userId);
    },
  };
}

/** The signed-in account behind a sync or backup request, or a Response to
 * send back instead. Also where per-account API rate limiting lives. */
export async function requireAccount(req: Request): Promise<string | Response> {
  const store: AuthApi | null = authStore();
  if (!store) return Response.json({ error: "Accounts not configured" }, { status: 503 });
  if (!sameOrigin(req)) {
    return Response.json({ error: "Cross-origin request refused" }, { status: 403 });
  }
  const session = await sessionUser(req, store, Date.now(), dev);
  if (!session) return Response.json({ error: "Not signed in" }, { status: 401 });

  const api = env().API_LIMITER;
  if (api && !(await limiter(api)(`api:${session.userId}`))) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }
  return session.userId;
}

function limiter(binding: RateLimiter) {
  return async (key: string) => (await binding.limit({ key })).success;
}

function turnstileVerifier(secret: string) {
  return async (token: string, ip: string | null): Promise<boolean> => {
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const outcome = (await res.json().catch(() => null)) as { success?: boolean } | null;
    return outcome?.success === true;
  };
}

function emailSender(binding: EmailBinding, from: string) {
  return async (to: string, code: string, purpose: CodePurpose): Promise<void> => {
    const what =
      purpose === "recover" ? "sign back in to Rampset" : "confirm this as your Rampset recovery email";
    const text = `Your code is ${code}\n\nEnter it in the app to ${what}. It expires in 10 minutes.\n\nIf you didn't ask for this, ignore this email — nothing changes without the code.`;
    const html = `<p style="font:16px/1.5 -apple-system,system-ui,sans-serif">Your code is</p>
<p style="font:600 32px/1.2 ui-monospace,Menlo,monospace;letter-spacing:4px">${code}</p>
<p style="font:16px/1.5 -apple-system,system-ui,sans-serif">Enter it in the app to ${what}. It expires in 10 minutes.</p>
<p style="font:14px/1.5 -apple-system,system-ui,sans-serif;color:#666">If you didn't ask for this, ignore this email — nothing changes without the code.</p>`;
    await binding.send({
      to,
      from: { email: from, name: "Rampset" },
      subject: `${code} is your Rampset code`,
      text,
      html,
    });
  };
}
