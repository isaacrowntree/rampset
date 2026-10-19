// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { memorySql } from "@/test/sqlite";
import { handleAuth, type AuthDeps, type WebAuthn } from "./handlers";
import { AuthStore } from "./store";
import { asyncStore } from "./stub";
import { base64url } from "./crypto";

const ORIGIN = "https://rampset.test";
const PROFILE = { unit: "kg", templateId: "5x5" };

/** WebAuthn with the cryptography stubbed out: options carry a fresh
 * challenge, and a "response" verifies when it names a credential. What's
 * under test is everything around the signature check. */
function fakeWebAuthn(): WebAuthn {
  let n = 0;
  return {
    generateRegistrationOptions: (async () => ({ challenge: `reg-${++n}` })) as never,
    generateAuthenticationOptions: (async () => ({ challenge: `auth-${++n}` })) as never,
    verifyRegistrationResponse: (async ({ response }: { response: { id: string } }) => ({
      verified: true,
      registrationInfo: { credential: { id: response.id, publicKey: new Uint8Array([7]), counter: 0 } },
    })) as never,
    verifyAuthenticationResponse: (async () => ({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    })) as never,
  };
}

function passkeyResponse(id: string, challenge: string) {
  const clientDataJSON = base64url(new TextEncoder().encode(JSON.stringify({ challenge })));
  return { id, rawId: id, type: "public-key", response: { clientDataJSON }, clientExtensionResults: {} };
}

let deps: AuthDeps;
let sent: { to: string; code: string }[];

beforeEach(() => {
  sent = [];
  deps = {
    store: asyncStore(new AuthStore(memorySql())),
    now: () => 1_000,
    dev: false,
    webauthn: fakeWebAuthn(),
    sendCode: async (to, code) => void sent.push({ to, code }),
    deleteUserData: vi.fn(async () => {}),
  };
});

async function call(action: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.cookie) headers.cookie = init.cookie;
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  if (method !== "GET") headers.origin = init.origin ?? ORIGIN;
  const res = await handleAuth(
    action,
    new Request(`${ORIGIN}/api/auth/${action}`, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    deps,
  );
  const setCookie = res.headers.get("set-cookie");
  return {
    status: res.status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shapes vary per action
    body: (await res.json()) as Record<string, any>,
    cookie: setCookie ? setCookie.split(";")[0] : undefined,
  };
}

async function signUp(name = "Isaac", keyId = "key-1") {
  const options = await call("register-options", { body: { name } });
  const res = await call("register-verify", {
    body: { name, profile: PROFILE, response: passkeyResponse(keyId, options.body.challenge) },
  });
  return res;
}

describe("creating an account", () => {
  it("signs the new account straight in", async () => {
    const res = await signUp();
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({ name: "Isaac", email: null, profile: { unit: "kg", templateId: "5x5" } });
    expect(res.cookie).toMatch(/^__Host-rampset_session=/);

    const me = await call("session", { cookie: res.cookie });
    expect(me.body.account.id).toBe(res.body.account.id);
  });

  it("won't verify against a challenge it never issued", async () => {
    const res = await call("register-verify", {
      body: { name: "Isaac", profile: PROFILE, response: passkeyResponse("k", "made-up") },
    });
    expect(res.status).toBe(400);
  });

  // The challenge carries the account id it's minting, so replaying one
  // registration can't mint the same account twice.
  it("won't redeem the same challenge twice", async () => {
    const options = await call("register-options", { body: { name: "Isaac" } });
    const body = { name: "Isaac", profile: PROFILE, response: passkeyResponse("k1", options.body.challenge) };
    expect((await call("register-verify", { body })).status).toBe(200);
    expect((await call("register-verify", { body })).status).toBe(400);
  });

  it("rejects an unknown program", async () => {
    const options = await call("register-options", { body: { name: "Isaac" } });
    const res = await call("register-verify", {
      body: { name: "Isaac", profile: { unit: "kg", templateId: "nope" }, response: passkeyResponse("k", options.body.challenge) },
    });
    expect(res.status).toBe(400);
  });

  it("needs Turnstile when the server has it", async () => {
    const verify = vi.fn(async (token: string) => token === "human");
    deps.turnstile = { siteKey: "site", verify };
    expect((await call("register-options", { body: { name: "Bot" } })).status).toBe(400);
    expect((await call("register-options", { body: { name: "Bot", turnstileToken: "robot" } })).status).toBe(400);
    expect((await call("register-options", { body: { name: "Isaac", turnstileToken: "human" } })).status).toBe(200);
  });
});

describe("signing in with a passkey", () => {
  it("finds the account from the passkey alone", async () => {
    const created = await signUp("Isaac", "key-1");
    const options = await call("login-options", { body: {} });
    const res = await call("login-verify", { body: { response: passkeyResponse("key-1", options.body.challenge) } });
    expect(res.status).toBe(200);
    expect(res.body.account.id).toBe(created.body.account.id);
    expect(res.cookie).not.toBe(created.cookie);
  });

  it("refuses a passkey no account uses", async () => {
    const options = await call("login-options", { body: {} });
    const res = await call("login-verify", { body: { response: passkeyResponse("stranger", options.body.challenge) } });
    expect(res.status).toBe(400);
  });
});

describe("sessions", () => {
  it("are 401 without a cookie", async () => {
    expect((await call("session")).status).toBe(401);
  });

  it("end on logout", async () => {
    const { cookie } = await signUp();
    const out = await call("logout", { body: {}, cookie });
    expect(out.cookie).toMatch(/=$/);
    expect((await call("session", { cookie })).status).toBe(401);
  });

  it("refuse a state change posted from another origin", async () => {
    const { cookie } = await signUp();
    const res = await call("logout", { body: {}, cookie, origin: "https://evil.test" });
    expect(res.status).toBe(403);
    expect((await call("session", { cookie })).status).toBe(200);
  });
});

describe("recovery email", () => {
  async function withEmail(email = "isaac@example.com") {
    const created = await signUp();
    await call("email-start", { body: { email }, cookie: created.cookie });
    const { code } = sent.pop()!;
    const verified = await call("email-verify", { body: { email, code }, cookie: created.cookie });
    return { ...created, verified };
  }

  it("is attached once the emailed code comes back", async () => {
    const { verified } = await withEmail();
    expect(verified.body.account.email).toBe("isaac@example.com");
  });

  it("can't be another account's email", async () => {
    await withEmail("shared@example.com");
    const other = await signUp("Sam", "key-2");
    const res = await call("email-start", { body: { email: "shared@example.com" }, cookie: other.cookie });
    expect(res.status).toBe(409);
  });

  it("isn't offered when the server can't send email", async () => {
    deps.sendCode = undefined;
    const { cookie } = await signUp();
    expect((await call("config")).body.email).toBe(false);
    expect((await call("email-start", { body: { email: "a@example.com" }, cookie })).status).toBe(404);
  });
});

describe("recovering an account", () => {
  async function accountWithEmail() {
    const created = await signUp();
    await call("email-start", { body: { email: "isaac@example.com" }, cookie: created.cookie });
    const { code } = sent.pop()!;
    await call("email-verify", { body: { email: "isaac@example.com", code }, cookie: created.cookie });
    return created;
  }

  it("signs in with the emailed code — and signs the lost device out", async () => {
    const lost = await accountWithEmail();
    expect((await call("recover-start", { body: { email: "Isaac@Example.com" } })).status).toBe(200);
    const { code } = sent.pop()!;

    const res = await call("recover-verify", { body: { email: "isaac@example.com", code } });
    expect(res.status).toBe(200);
    expect(res.body.account.id).toBe(lost.body.account.id);
    expect((await call("session", { cookie: res.cookie })).status).toBe(200);
    expect((await call("session", { cookie: lost.cookie })).status).toBe(401);
  });

  // Same answer either way, and no email: a stranger can't use this to learn
  // who has an account.
  it("answers the same for an email with no account", async () => {
    const res = await call("recover-start", { body: { email: "nobody@example.com" } });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("refuses a wrong code", async () => {
    await accountWithEmail();
    await call("recover-start", { body: { email: "isaac@example.com" } });
    const { code } = sent.pop()!;
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await call("recover-verify", { body: { email: "isaac@example.com", code: wrong } })).status).toBe(400);
  });

  it("lets the recovered account add a passkey for this device", async () => {
    await accountWithEmail();
    await call("recover-start", { body: { email: "isaac@example.com" } });
    const { code } = sent.pop()!;
    const { cookie } = await call("recover-verify", { body: { email: "isaac@example.com", code } });

    const options = await call("passkey-options", { body: {}, cookie });
    const added = await call("passkey-verify", { body: { response: passkeyResponse("key-new", options.body.challenge) }, cookie });
    expect(added.status).toBe(200);

    const login = await call("login-options", { body: {} });
    const res = await call("login-verify", { body: { response: passkeyResponse("key-new", login.body.challenge) } });
    expect(res.status).toBe(200);
  });
});

describe("the profile", () => {
  // A device changes one thing at a time (theme, program); the rest of the
  // stored profile must survive it.
  it("takes a partial update and keeps the rest", async () => {
    const { cookie } = await signUp();
    const res = await call("profile", { method: "PUT", body: { profile: { theme: "light" } }, cookie });
    expect(res.body.account.profile).toMatchObject({ theme: "light", templateId: "5x5", unit: "kg" });
  });

  it("still refuses an unknown program", async () => {
    const { cookie } = await signUp();
    const res = await call("profile", { method: "PUT", body: { profile: { templateId: "nope" } }, cookie });
    expect(res.status).toBe(400);
  });
});

describe("deleting an account", () => {
  it("removes its data, then the account", async () => {
    const { cookie, body } = await signUp();
    const res = await call("delete-account", { body: {}, cookie });
    expect(res.status).toBe(200);
    expect(deps.deleteUserData).toHaveBeenCalledWith(body.account.id);
    expect((await call("session", { cookie })).status).toBe(401);
  });
});

describe("rate limits", () => {
  it("turn away a client over its limit", async () => {
    deps.rateLimit = async () => false;
    expect((await call("login-options", { body: {} })).status).toBe(429);
  });
});
