"use client";

/** Guards writes that leave this device against the account they'll be filed
 * under.
 *
 * `/api/sync` and `/api/backup` file everything under the session cookie's
 * account, while the rows they carry belong to this device's local user. Those
 * are the same account by construction — the device adopts the account it
 * signs in as — but the cookie can change underneath us (signed out in another
 * tab, a session revoked by recovery, a stale device). Pushing then would file
 * this device's workouts under someone else, permanently, in an append-only
 * log. So writes go out only for the account the server last confirmed. */

/** The last account the server confirmed. Survives reloads because it changes
 * almost never, while the request that confirms it fails routinely — a cold
 * mobile network in a gym. */
const CACHE_KEY = "liftlog.sessionAccount";

let confirmed: string | null = remembered();

function remembered(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(CACHE_KEY);
  } catch {
    return null;
  }
}

/** What the session check found: an account id, null for signed out, or
 * undefined when it couldn't tell (offline) — which changes nothing. */
export function setSessionAccount(userId: string | null | undefined): void {
  if (userId === undefined) return;
  confirmed = userId;
  try {
    if (userId) localStorage.setItem(CACHE_KEY, userId);
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // private mode — we just re-confirm next launch
  }
}

/** May we send `userId`'s data under the current session? */
export function mayWriteAs(userId: string): boolean {
  return confirmed === userId;
}
