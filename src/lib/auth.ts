"use client";

/** The client side of sign-in: /api/auth/* calls, and the passkey ceremonies
 * between them. Each call either returns what it promised or throws an
 * AuthError carrying a message fit to show the lifter. */

import { startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import type { Account } from "@/db/account";

/** `cancelled`: the lifter dismissed the passkey sheet — nothing to show.
 * `already-registered`: this device already has the passkey — the goal met. */
export type AuthErrorKind = "cancelled" | "already-registered";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly kind?: AuthErrorKind,
  ) {
    super(message);
  }
}

export interface AuthConfig {
  /** False when the server has no accounts (`next dev`, or a self-host without
   * the AUTH binding): the app then lives on this device alone. */
  accounts: boolean;
  email: boolean;
  turnstileSiteKey: string | null;
}

async function call<T>(action: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/auth/${action}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AuthError("You're offline — connect and try again.");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new AuthError(data?.error ?? `Something went wrong (${res.status})`, res.status);
  return data as T;
}

/** The passkey prompt, with the browser's errors turned into plain words. */
async function ceremony<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    // Dismissing the sheet surfaces as NotAllowedError — bare, or wrapped.
    const name = e instanceof Error ? ((e.cause as Error | undefined)?.name ?? e.name) : "";
    if (name === "NotAllowedError" || (e instanceof WebAuthnError && e.code === "ERROR_CEREMONY_ABORTED")) {
      throw new AuthError("Cancelled.", 0, "cancelled");
    }
    if (e instanceof WebAuthnError && e.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      throw new AuthError("This device already has a passkey for your account.", 0, "already-registered");
    }
    throw new AuthError("This browser couldn't use a passkey.");
  }
}

/** The message to show for a failed auth step, or null when there's nothing
 * to say (the lifter dismissed the prompt). */
export function authErrorMessage(e: unknown, fallback: string): string | null {
  if (e instanceof AuthError) return e.kind === "cancelled" ? null : e.message;
  return fallback;
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

export async function authConfig(): Promise<AuthConfig> {
  try {
    return { ...(await call<Omit<AuthConfig, "accounts">>("config")), accounts: true };
  } catch (e) {
    if (e instanceof AuthError && e.status === 503) return { accounts: false, email: false, turnstileSiteKey: null };
    throw e;
  }
}

/** The signed-in account, null when signed out, undefined when we couldn't
 * tell (offline). Offline is not signed out. */
export async function currentAccount(): Promise<Account | null | undefined> {
  try {
    return (await call<{ account: Account }>("session")).account;
  } catch (e) {
    return e instanceof AuthError && e.status === 401 ? null : undefined;
  }
}

export async function createAccount(
  name: string,
  profile: Pick<Account["profile"], "unit" | "templateId" | "theme">,
  turnstileToken?: string,
): Promise<Account> {
  const optionsJSON = await call<Parameters<typeof startRegistration>[0]["optionsJSON"]>("register-options", {
    name,
    turnstileToken,
  });
  const response = await ceremony(() => startRegistration({ optionsJSON }));
  return (await call<{ account: Account }>("register-verify", { name, profile, response })).account;
}

export async function signInWithPasskey(): Promise<Account> {
  const optionsJSON = await call<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("login-options", {});
  const response = await ceremony(() => startAuthentication({ optionsJSON }));
  return (await call<{ account: Account }>("login-verify", { response })).account;
}

/** After recovering by email: a passkey for this device, on the same account. */
export async function addPasskey(): Promise<void> {
  const optionsJSON = await call<Parameters<typeof startRegistration>[0]["optionsJSON"]>("passkey-options", {});
  const response = await ceremony(() => startRegistration({ optionsJSON }));
  await call("passkey-verify", { response });
}

export const startRecovery = (email: string, turnstileToken?: string) =>
  call("recover-start", { email, turnstileToken });

export const finishRecovery = async (email: string, code: string) =>
  (await call<{ account: Account }>("recover-verify", { email, code })).account;

export const startEmailVerification = (email: string) => call("email-start", { email });

export const finishEmailVerification = async (email: string, code: string) =>
  (await call<{ account: Account }>("email-verify", { email, code })).account;

export const updateProfile = async (patch: { name?: string; profile?: Partial<Account["profile"]> }) =>
  (await call<{ account: Account }>("profile", patch, "PUT")).account;

export const signOut = () => call("logout", {});

export const deleteAccount = () => call("delete-account", {});
