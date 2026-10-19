/** The session cookie, and turning a request back into an account id.
 *
 * HttpOnly so no script can read it, SameSite=Lax so another site can't post
 * with it, and `__Host-` in production so it can only ever be set by this
 * origin over HTTPS. Local dev runs on plain http://localhost, where a Secure
 * cookie doesn't stick in every browser — so dev drops the prefix and the flag. */

import { sha256 } from "./crypto";
import type { AuthApi } from "./stub";

/** Re-sent on every session check, so the browser's own expiry slides along
 * with the server's (browsers cap cookies at 400 days). */
const MAX_AGE_S = 400 * 24 * 60 * 60;

function cookieName(dev: boolean): string {
  return dev ? "rampset_session" : "__Host-rampset_session";
}

export function sessionCookie(token: string, dev: boolean): string {
  const secure = dev ? "" : "; Secure";
  return `${cookieName(dev)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`;
}

export function clearedCookie(dev: boolean): string {
  const secure = dev ? "" : "; Secure";
  return `${cookieName(dev)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function sessionToken(req: Request, dev: boolean): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const name = cookieName(dev);
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** A state-changing request must come from our own pages. SameSite=Lax
 * already keeps the cookie off cross-site POSTs; this refuses them outright,
 * so nothing depends on a browser getting SameSite right. */
export function sameOrigin(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.get("origin");
  return origin === null || origin === new URL(req.url).origin;
}

/** The account behind this request's session cookie, or null. */
export async function sessionUser(
  req: Request,
  store: AuthApi,
  now: number,
  dev: boolean,
): Promise<{ userId: string; tokenHash: string } | null> {
  const token = sessionToken(req, dev);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const userId = await store.session(tokenHash, now);
  return userId ? { userId, tokenHash } : null;
}
