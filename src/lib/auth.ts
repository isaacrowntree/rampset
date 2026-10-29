"use client";

/** The client side of sign-in: durable-auth's client at /api/auth, in the
 * shapes the app uses. Each call either returns what it promised or throws an
 * AuthError carrying a message fit to show the lifter.
 *
 * Deleting the account and changing the recovery email may ask for Face ID
 * first when this device hasn't used its passkey in the last few minutes —
 * the library does that itself, then carries on. */

import { AuthError, createAuthClient } from "durable-auth/client";
import type { Account } from "@/db/account";

export {
  AuthError,
  authErrorMessage,
  passkeysSupported,
  type AuthErrorKind,
  type PasskeySummary,
} from "durable-auth/client";

const client = createAuthClient<Account["profile"]>({ basePath: "/api/auth" });

export interface AuthConfig {
  /** False when the server has no accounts (`next dev`, or a self-host without
   * the AUTH binding): the app then lives on this device alone. */
  accounts: boolean;
  email: boolean;
  turnstileSiteKey: string | null;
}

export async function authConfig(): Promise<AuthConfig> {
  try {
    return { ...(await client.config()), accounts: true };
  } catch (e) {
    if (e instanceof AuthError && e.status === 503) return { accounts: false, email: false, turnstileSiteKey: null };
    throw e;
  }
}

/** The signed-in account, null when signed out, undefined when we couldn't
 * tell (offline). Offline is not signed out. */
export const currentAccount = (): Promise<Account | null | undefined> => client.session();

export const createAccount = (
  name: string,
  profile: Pick<Account["profile"], "unit" | "templateId" | "theme">,
  turnstileToken?: string,
): Promise<Account> => client.register(name, profile, turnstileToken);

export const signInWithPasskey = (): Promise<Account> => client.signIn();

/** After recovering by email: a passkey for this device, on the same account. */
export const addPasskey = (): Promise<void> => client.addPasskey();

export const startRecovery = (email: string, turnstileToken?: string) => client.startRecovery(email, turnstileToken);
export const finishRecovery = (email: string, code: string): Promise<Account> => client.finishRecovery(email, code);
export const startEmailVerification = (email: string) => client.startEmailVerification(email);
export const finishEmailVerification = (email: string, code: string): Promise<Account> =>
  client.finishEmailVerification(email, code);

export const updateProfile = (patch: { name?: string; profile?: Partial<Account["profile"]> }): Promise<Account> =>
  client.updateProfile(patch);

export const signOut = () => client.signOut();
/** Signs every other device out; this one stays signed in. */
export const signOutOtherDevices = () => client.signOutOtherDevices();
export const listPasskeys = () => client.passkeys();
/** May ask for Face ID first (step-up); the library handles that. */
export const removePasskey = (id: string) => client.removePasskey(id);
export const deleteAccount = () => client.deleteAccount();
