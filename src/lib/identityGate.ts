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

let accessEmail: string | null = null;

/** Called once identity resolves (or doesn't) — see UserContext. */
export function setAccessIdentity(email: string | null): void {
  accessEmail = email;
}

/** May we file `email`'s data under the current Access session? */
export function mayWriteAs(email: string): boolean {
  // Unresolved identity is routine: /api/me has a 2s timeout and falls back to
  // a saved selection. Blocking then would strand a device that is almost
  // certainly fine, and the server is the real authority regardless.
  if (accessEmail === null) return true;
  return accessEmail.toLowerCase() === email.toLowerCase();
}
