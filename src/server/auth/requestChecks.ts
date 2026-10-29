/** Checks on a sync or backup request that need nothing but the request. */

/** A cookie-authenticated write must come from our own pages: the Origin
 * says so, or, where a browser sends none, Sec-Fetch-Site does. The same rule
 * durable-auth applies to its own routes. */
export function sameOrigin(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.get("origin");
  if (origin === null) return req.headers.get("sec-fetch-site") === "same-origin";
  return origin === new URL(req.url).origin;
}

/** The header naming the account a request's data belongs to. */
export const ACCOUNT_HEADER = "x-account";

/** The cookie decides whose journal and backups a request reaches; the rows it
 * carries belong to whichever account the sending tab holds. Those can part —
 * a tab left open across a sign-out and someone else's sign-in — and filing
 * one account's workouts under another can't be undone. So the client names
 * its account and the server refuses a request that names any other. A 409
 * carries no `seq`, so the outbox keeps everything for the right account. */
export function wrongAccount(req: Request, userId: string): Response | null {
  if (req.headers.get(ACCOUNT_HEADER) === userId) return null;
  return Response.json({ error: "This device is signed in to a different account — reload to continue" }, { status: 409 });
}
