/** Sign-in, wired to the Worker's bindings. The logic is durable-auth; this
 * is Rampset's choices for it. Every binding but AUTH is optional — a fresh
 * self-host works with none of them and grows features as they're added. */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  cloudflareEmail,
  createAuth,
  rateLimitBinding,
  turnstileVerifier,
  type Auth,
  type AuthNamespace,
  type EmailBinding,
  type RateLimitBinding,
} from "durable-auth/server";
import type { BackupBucket } from "@/server/backupStore";
import { parseProfile, type Profile } from "./parseProfile";
import { deleteUserData, type UserDataEnv } from "./userData";
import { sameOrigin, wrongAccount } from "./requestChecks";

interface AuthEnv {
  AUTH?: AuthNamespace;
  EMAIL?: EmailBinding;
  /** The From address for codes, e.g. noreply@your-domain. Its domain must be
   * onboarded to Cloudflare Email Sending. */
  EMAIL_FROM?: string;
  /** The key recovery codes are hashed under; 32+ characters. Email recovery
   * stays off without it: `openssl rand -base64 32 | wrangler secret put
   * AUTH_CODE_SECRET`. */
  AUTH_CODE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  AUTH_LIMITER?: RateLimitBinding;
  API_LIMITER?: RateLimitBinding;
  BACKUPS?: BackupBucket;
}

function env(): AuthEnv {
  return getCloudflareContext().env as AuthEnv;
}

/** Null when the server has no AUTH binding (`next dev`): the app then lives
 * on the device alone. */
export function rampsetAuth(): Auth<Profile> | null {
  const e = env();
  if (!e.AUTH) return null;
  return createAuth<Profile>({
    store: e.AUTH,
    rpName: "Rampset",
    basePath: "/api/auth",
    cookieName: "rampset_session",
    maxNameLength: 40,
    parseProfile,
    sendCode:
      e.EMAIL && e.EMAIL_FROM && e.AUTH_CODE_SECRET
        ? cloudflareEmail(e.EMAIL, { from: e.EMAIL_FROM, appName: "Rampset" })
        : undefined,
    codeSecret: e.AUTH_CODE_SECRET,
    turnstile:
      e.TURNSTILE_SITE_KEY && e.TURNSTILE_SECRET_KEY
        ? { siteKey: e.TURNSTILE_SITE_KEY, verify: turnstileVerifier(e.TURNSTILE_SECRET_KEY) }
        : undefined,
    rateLimit: e.AUTH_LIMITER ? rateLimitBinding(e.AUTH_LIMITER) : undefined,
    waitUntil: (work) => getCloudflareContext().ctx.waitUntil(work),
    onDeleteAccount: (userId) => deleteUserData(e as UserDataEnv, userId),
  });
}

/** The signed-in account behind a sync or backup request, or a Response to
 * send back instead. Also where per-account API rate limiting lives. */
export async function requireAccount(req: Request): Promise<string | Response> {
  const auth = rampsetAuth();
  if (!auth) return Response.json({ error: "Accounts not configured" }, { status: 503 });
  if (!sameOrigin(req)) return Response.json({ error: "Cross-origin request refused" }, { status: 403 });
  const session = await auth.session(req);
  if (!session) return Response.json({ error: "Not signed in" }, { status: 401 });
  const mismatch = wrongAccount(req, session.userId);
  if (mismatch) return mismatch;

  const api = env().API_LIMITER;
  if (api && !(await rateLimitBinding(api)(`api:${session.userId}`))) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }
  return session.userId;
}
