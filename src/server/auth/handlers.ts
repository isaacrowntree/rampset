/** Sign-in, as plain functions from a Request to a Response.
 *
 * Passkeys are the login; a verified email is only for getting back in after
 * losing every device. Anyone can create an account. Everything the outside
 * world provides — the store, email, Turnstile, rate limits, WebAuthn itself —
 * arrives in `deps`, so the route file is wiring and this file is testable. */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getTemplate } from "@/lib/programTemplates";
import { hashCode, newAccountId, randomToken, sha256, sixDigitCode } from "./crypto";
import { clearedCookie, sameOrigin, sessionCookie, sessionToken, sessionUser } from "./session";
import { normalizeEmail, type AccountView, type CodePurpose, type Profile } from "./store";
import type { AuthApi } from "./stub";

export interface WebAuthn {
  generateRegistrationOptions: typeof generateRegistrationOptions;
  verifyRegistrationResponse: typeof verifyRegistrationResponse;
  generateAuthenticationOptions: typeof generateAuthenticationOptions;
  verifyAuthenticationResponse: typeof verifyAuthenticationResponse;
}

export const realWebAuthn: WebAuthn = {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
};

export interface AuthDeps {
  store: AuthApi;
  now: () => number;
  dev: boolean;
  webauthn: WebAuthn;
  /** Absent when the server has no email binding: recovery is then off, and
   * the app says so rather than pretending to send. */
  sendCode?: (to: string, code: string, purpose: CodePurpose) => Promise<void>;
  /** Absent when Turnstile isn't configured. */
  turnstile?: { siteKey: string; verify: (token: string, ip: string | null) => Promise<boolean> };
  /** true = allowed. Absent = unlimited (local dev, or no binding). */
  rateLimit?: (key: string) => Promise<boolean>;
  /** Remove what the account owns outside auth: its journal and backups. */
  deleteUserData: (userId: string) => Promise<void>;
  /** Finish work after the response (ctx.waitUntil). Absent = await inline. */
  defer?: (work: Promise<unknown>) => void;
}

const RP_NAME = "Rampset";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

export async function handleAuth(action: string, req: Request, deps: AuthDeps): Promise<Response> {
  try {
    if (!sameOrigin(req)) fail(403, "Cross-origin request refused");
    const handler = HANDLERS[`${req.method} ${action}`];
    if (!handler) return Response.json({ error: "Not found" }, { status: 404 });
    return await handler(req, deps);
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

type Handler = (req: Request, deps: AuthDeps) => Promise<Response>;

const HANDLERS: Record<string, Handler> = {
  "GET config": async (_req, deps) =>
    Response.json({ email: Boolean(deps.sendCode), turnstileSiteKey: deps.turnstile?.siteKey ?? null }),

  "GET session": async (req, deps) => {
    const { userId } = await requireSession(req, deps);
    const account = await deps.store.account(userId);
    if (!account) fail(401, "Not signed in");
    // Re-set the same cookie: its browser-side expiry slides with use.
    const token = sessionToken(req, deps.dev)!;
    return Response.json({ account }, { headers: { "set-cookie": sessionCookie(token, deps.dev) } });
  },

  "POST logout": async (req, deps) => {
    const session = await sessionUser(req, deps.store, deps.now(), deps.dev);
    if (session) await deps.store.deleteSession(session.tokenHash);
    return Response.json({ ok: true }, { headers: { "set-cookie": clearedCookie(deps.dev) } });
  },

  // ---- create an account ----------------------------------------------

  "POST register-options": async (req, deps) => {
    await limit(req, deps, "register");
    const body = await json<{ name?: unknown; turnstileToken?: unknown }>(req);
    const name = parseName(body.name);
    await requireHuman(req, deps, body.turnstileToken);

    const userId = newAccountId();
    const { rpID } = relyingParty(req);
    const options = await deps.webauthn.generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: name,
      userDisplayName: name,
      userID: new TextEncoder().encode(userId),
      attestationType: "none",
      // Discoverable, so signing in on a new phone needs no username.
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    await deps.store.createChallenge(options.challenge, "register", userId, deps.now());
    return Response.json(options);
  },

  "POST register-verify": async (req, deps) => {
    await limit(req, deps, "register");
    const body = await json<{ response?: RegistrationResponseJSON; name?: unknown; profile?: unknown }>(req);
    const name = parseName(body.name);
    const profile = parseProfile(body.profile);
    const response = body.response ?? fail(400, "Missing passkey response");

    const challenge = clientChallenge(response);
    const issued = await deps.store.consumeChallenge(challenge, "register", deps.now());
    if (!issued?.userId) fail(400, "That sign-up expired — try again");
    const userId = issued!.userId!;

    const { rpID, origin } = relyingParty(req);
    const result = await deps.webauthn
      .verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      })
      .catch(() => ({ verified: false as const }));
    if (!result.verified) fail(400, "Passkey couldn't be verified");
    const { credential } = result.registrationInfo!;
    // Checked before the account exists, so a refusal leaves nothing behind.
    if (await deps.store.passkey(credential.id)) fail(400, "This passkey is already in use");

    const now = deps.now();
    const account = await deps.store.createAccount(userId, name, profile, now);
    await deps.store.addPasskey(
      {
        id: credential.id,
        userId,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports,
      },
      now,
    );
    return signedIn(account, deps);
  },

  // ---- sign in with a passkey -----------------------------------------

  "POST login-options": async (req, deps) => {
    await limit(req, deps, "login");
    const { rpID } = relyingParty(req);
    const options = await deps.webauthn.generateAuthenticationOptions({
      rpID,
      userVerification: "required",
    });
    await deps.store.createChallenge(options.challenge, "login", null, deps.now());
    return Response.json(options);
  },

  "POST login-verify": async (req, deps) => {
    await limit(req, deps, "login");
    const body = await json<{ response?: AuthenticationResponseJSON }>(req);
    const response = body.response ?? fail(400, "Missing passkey response");

    const challenge = clientChallenge(response);
    if (!(await deps.store.consumeChallenge(challenge, "login", deps.now()))) {
      fail(400, "That sign-in expired — try again");
    }
    const key = await deps.store.passkey(response.id);
    // A passkey we don't know: most often the account was deleted, and the
    // phone still offers its key.
    if (!key) fail(400, "No account uses this passkey");

    const { rpID, origin } = relyingParty(req);
    const result = await deps.webauthn
      .verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: key!.id,
          publicKey: new Uint8Array(key!.publicKey),
          counter: key!.counter,
          transports: key!.transports,
        },
        requireUserVerification: true,
      })
      .catch(() => ({ verified: false as const, authenticationInfo: undefined }));
    if (!result.verified) fail(400, "Passkey couldn't be verified");

    await deps.store.setPasskeyCounter(key!.id, result.authenticationInfo!.newCounter);
    const account = await deps.store.account(key!.userId);
    if (!account) fail(400, "No account uses this passkey");
    return signedIn(account!, deps);
  },

  // ---- add a passkey to the signed-in account (after recovery) --------

  "POST passkey-options": async (req, deps) => {
    const { userId } = await requireSession(req, deps);
    const account = (await deps.store.account(userId)) ?? fail(401, "Not signed in");
    const { rpID } = relyingParty(req);
    const existing = await deps.store.passkeysFor(userId);
    const options = await deps.webauthn.generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: account.name,
      userDisplayName: account.name,
      userID: new TextEncoder().encode(userId),
      attestationType: "none",
      excludeCredentials: existing.map((k) => ({ id: k.id, transports: k.transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    await deps.store.createChallenge(options.challenge, "add-passkey", userId, deps.now());
    return Response.json(options);
  },

  "POST passkey-verify": async (req, deps) => {
    const { userId } = await requireSession(req, deps);
    const body = await json<{ response?: RegistrationResponseJSON }>(req);
    const response = body.response ?? fail(400, "Missing passkey response");

    const challenge = clientChallenge(response);
    const issued = await deps.store.consumeChallenge(challenge, "add-passkey", deps.now());
    if (issued?.userId !== userId) fail(400, "That expired — try again");

    const { rpID, origin } = relyingParty(req);
    const result = await deps.webauthn
      .verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      })
      .catch(() => ({ verified: false as const }));
    if (!result.verified) fail(400, "Passkey couldn't be verified");

    const { credential } = result.registrationInfo!;
    if (await deps.store.passkey(credential.id)) fail(400, "This passkey is already in use");
    await deps.store.addPasskey(
      {
        id: credential.id,
        userId,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports,
      },
      deps.now(),
    );
    return Response.json({ ok: true });
  },

  // ---- recovery by email ----------------------------------------------

  "POST recover-start": async (req, deps) => {
    const send = deps.sendCode ?? fail(404, "Email recovery isn't set up on this server");
    await limit(req, deps, "email");
    const body = await json<{ email?: unknown; turnstileToken?: unknown }>(req);
    const email = parseEmail(body.email);
    await requireHuman(req, deps, body.turnstileToken);

    // The same answer, in the same time, whether or not the email has an
    // account: this endpoint must not tell a stranger who uses the app. So
    // the lookup and the send happen after the response.
    const work = (async () => {
      const account = await deps.store.accountByEmail(email);
      if (!account) return;
      const code = sixDigitCode();
      const issued = await deps.store.issueCode(
        email,
        "recover",
        account.id,
        await hashCode(email, "recover", code),
        deps.now(),
      );
      if (issued === "ok") await send(email, code, "recover");
    })();
    if (deps.defer) deps.defer(work.catch(() => {}));
    else await work;
    return Response.json({ ok: true });
  },

  "POST recover-verify": async (req, deps) => {
    await limit(req, deps, "email");
    const body = await json<{ email?: unknown; code?: unknown }>(req);
    const email = parseEmail(body.email);
    const code = parseCode(body.code);
    const redeemed = await deps.store.redeemCode(
      email,
      "recover",
      await hashCode(email, "recover", code),
      deps.now(),
    );
    if (!redeemed) fail(400, "That code is wrong or has expired");

    // Recovering means a device was lost — possibly stolen, passkey and all.
    // Sign the account out everywhere and take its passkeys away; the client
    // adds a fresh one for this device next.
    await deps.store.deleteSessionsFor(redeemed!.userId);
    await deps.store.deletePasskeysFor(redeemed!.userId);
    const account = (await deps.store.account(redeemed!.userId)) ?? fail(400, "Account not found");
    return signedIn(account, deps);
  },

  // ---- the signed-in account's recovery email -------------------------

  "POST email-start": async (req, deps) => {
    const send = deps.sendCode ?? fail(404, "Email isn't set up on this server");
    const { userId } = await requireSession(req, deps);
    await limit(req, deps, "email");
    const email = parseEmail((await json<{ email?: unknown }>(req)).email);

    // Someone else's email: answer as if sent, and send nothing. Open sign-up
    // would otherwise make this a way to ask who uses the app.
    const owner = await deps.store.accountByEmail(email);
    if (owner && owner.id !== userId) return Response.json({ ok: true });

    const code = sixDigitCode();
    const issued = await deps.store.issueCode(
      email,
      "verify-email",
      userId,
      await hashCode(email, "verify-email", code),
      deps.now(),
    );
    if (issued === "rate-limited") fail(429, "Too many codes sent to that email — try again in an hour");
    await send(email, code, "verify-email");
    return Response.json({ ok: true });
  },

  "POST email-verify": async (req, deps) => {
    const { userId } = await requireSession(req, deps);
    await limit(req, deps, "email");
    const body = await json<{ email?: unknown; code?: unknown }>(req);
    const email = parseEmail(body.email);
    const code = parseCode(body.code);
    const redeemed = await deps.store.redeemCode(
      email,
      "verify-email",
      await hashCode(email, "verify-email", code),
      deps.now(),
    );
    if (redeemed?.userId !== userId) fail(400, "That code is wrong or has expired");

    const account = await deps.store.setEmail(userId, email);
    if (account === "taken") fail(409, "That email is already used by another account");
    return Response.json({ account });
  },

  // ---- the account itself ---------------------------------------------

  "PUT profile": async (req, deps) => {
    const { userId } = await requireSession(req, deps);
    const body = await json<{ name?: unknown; profile?: unknown }>(req);
    const current = (await deps.store.account(userId)) ?? fail(401, "Not signed in");
    // Partial: a device changes one thing at a time (theme, program).
    const patch = body.profile && typeof body.profile === "object" ? body.profile : undefined;
    const account = await deps.store.updateAccount(userId, {
      name: body.name === undefined ? undefined : parseName(body.name),
      profile: patch === undefined ? undefined : parseProfile({ ...current.profile, ...patch }),
    });
    return Response.json({ account });
  },

  "POST delete-account": async (req, deps) => {
    const { userId } = await requireSession(req, deps);
    // Every device out first, so nothing in flight recreates what's being
    // erased. Then the data — if that fails, the account still exists to
    // retry with (sign in again) — then the account.
    await deps.store.deleteSessionsFor(userId);
    await deps.deleteUserData(userId);
    await deps.store.deleteAccount(userId);
    return Response.json({ ok: true }, { headers: { "set-cookie": clearedCookie(deps.dev) } });
  },
};

// ---- helpers ------------------------------------------------------------

async function signedIn(account: AccountView, deps: AuthDeps): Promise<Response> {
  const token = randomToken();
  await deps.store.createSession(await sha256(token), account.id, deps.now());
  return Response.json({ account }, { headers: { "set-cookie": sessionCookie(token, deps.dev) } });
}

async function requireSession(req: Request, deps: AuthDeps) {
  const session = await sessionUser(req, deps.store, deps.now(), deps.dev);
  return session ?? fail(401, "Not signed in");
}

/** WebAuthn binds to the host the page was served from. Behind OpenNext the
 * request URL is the public one, so it's the right source for both. */
function relyingParty(req: Request): { rpID: string; origin: string } {
  const url = new URL(req.url);
  return { rpID: url.hostname, origin: url.origin };
}

/** The challenge the authenticator signed, read back out of clientDataJSON.
 * We look it up ourselves (rather than handing the library a predicate) so
 * the lookup also tells us which account a registration is for. */
function clientChallenge(response: { response?: { clientDataJSON?: string } }): string {
  try {
    const b64 = response.response!.clientDataJSON!.replace(/-/g, "+").replace(/_/g, "/");
    const data = JSON.parse(atob(b64)) as { challenge?: unknown };
    if (typeof data.challenge === "string" && data.challenge) return data.challenge;
  } catch {
    // fall through
  }
  return fail(400, "Malformed passkey response");
}

function clientIp(req: Request): string | null {
  return req.headers.get("cf-connecting-ip");
}

async function limit(req: Request, deps: AuthDeps, bucket: string): Promise<void> {
  if (!deps.rateLimit) return;
  const ok = await deps.rateLimit(`${bucket}:${clientIp(req) ?? "unknown"}`);
  if (!ok) fail(429, "Too many attempts — wait a minute and try again");
}

async function requireHuman(req: Request, deps: AuthDeps, token: unknown): Promise<void> {
  if (!deps.turnstile) return;
  if (typeof token !== "string" || !(await deps.turnstile.verify(token, clientIp(req)))) {
    fail(400, "Couldn't confirm you're human — try again");
  }
}

async function json<T>(req: Request): Promise<T> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" ? (body as T) : fail(400, "Expected a JSON body");
}

function parseName(v: unknown): string {
  const name = typeof v === "string" ? v.trim() : "";
  if (!name || name.length > 40) fail(400, "Enter a name up to 40 characters");
  return name;
}

function parseEmail(v: unknown): string {
  const email = typeof v === "string" ? normalizeEmail(v) : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Enter a valid email");
  return email;
}

function parseCode(v: unknown): string {
  const code = typeof v === "string" ? v.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(code)) fail(400, "Enter the 6-digit code");
  return code;
}

function parseProfile(v: unknown): Profile {
  const p = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof Profile, unknown>>;
  if (p.unit !== "kg" && p.unit !== "lb") fail(400, "Unit must be kg or lb");
  if (typeof p.templateId !== "string" || !getTemplate(p.templateId)) fail(400, "Unknown program");
  return {
    unit: p.unit as Profile["unit"],
    templateId: p.templateId as string,
    accent: p.accent === "green" ? "green" : "blue",
    theme: p.theme === "light" ? "light" : "dark",
  };
}
