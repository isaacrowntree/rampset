"use client";

/** Guards writes that leave this device against the identity they'll be
 * filed under.
 *
 * `/api/sync` and `/api/backup` are both routed by the server-side Cloudflare
 * Access email, but the rows they carry belong to whichever avatar is selected
 * here — and the switcher is one tap away. Finish a workout as someone else and
 * their workouts land in YOUR journal; back up as someone else and their whole
 * database overwrites YOUR latest.json.
 *
 * The two identities can't be reconciled client-side, so the honest move is to
 * refuse to write when they disagree. */

/** The last identity we actually resolved. Survives reloads because the
 * identity changes almost never, while the request that reveals it fails
 * routinely — /api/me has a 2s timeout and a cold mobile network blows it. */
const CACHE_KEY = "liftlog.accessIdentity";

let accessEmail: string | null = null;

function remembered(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(CACHE_KEY);
  } catch {
    return null;
  }
}

/** Called once identity resolves (or doesn't) — see UserContext. */
export function setAccessIdentity(email: string | null): void {
  if (email) {
    accessEmail = email;
    try {
      localStorage?.setItem(CACHE_KEY, email);
    } catch {
      // private mode — we just re-resolve next launch
    }
    return;
  }
  // Unresolved this launch. Fall back to whoever we last resolved rather than
  // opening the gate: a flaky request is not evidence that the user changed.
  accessEmail = remembered();
}

/** May we file `email`'s data under the current Access session? */
export function mayWriteAs(email: string): boolean {
  // Only a device that has NEVER resolved an identity gets the benefit of the
  // doubt. Once we've seen one, a failed /api/me falls back to it instead.
  if (accessEmail === null) return true;
  return accessEmail.toLowerCase() === email.toLowerCase();
}
