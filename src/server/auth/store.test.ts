// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { memorySql } from "@/test/sqlite";
import {
  AuthStore,
  CHALLENGE_TTL_MS,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  CODES_PER_HOUR,
  SESSION_TTL_MS,
  type Profile,
} from "./store";

const PROFILE: Profile = { unit: "kg", templateId: "5x5", accent: "blue", theme: "dark" };
const DAY = 24 * 60 * 60 * 1000;
let store: AuthStore;

beforeEach(() => {
  store = new AuthStore(memorySql());
});

describe("challenges", () => {
  it("are single use", () => {
    store.createChallenge("c1", "login", null, 0);
    expect(store.consumeChallenge("c1", "login", 1)).toEqual({ userId: null });
    expect(store.consumeChallenge("c1", "login", 2)).toBeNull();
  });

  it("carry the account a registration is minting", () => {
    store.createChallenge("c1", "register", "u_new", 0);
    expect(store.consumeChallenge("c1", "register", 1)).toEqual({ userId: "u_new" });
  });

  // A login challenge replayed into the registration flow (or vice versa)
  // must not verify — and is burned for trying.
  it("only redeem for the purpose they were issued for", () => {
    store.createChallenge("c1", "login", null, 0);
    expect(store.consumeChallenge("c1", "register", 1)).toBeNull();
    expect(store.consumeChallenge("c1", "login", 2)).toBeNull();
  });

  it("expire", () => {
    store.createChallenge("c1", "login", null, 0);
    expect(store.consumeChallenge("c1", "login", CHALLENGE_TTL_MS)).toBeNull();
  });
});

describe("accounts", () => {
  it("round-trip with their profile", () => {
    store.createAccount("u1", "Isaac", PROFILE, 0);
    expect(store.account("u1")).toEqual({ id: "u1", name: "Isaac", email: null, profile: PROFILE });
  });

  it("find by email, case-insensitively", () => {
    store.createAccount("u1", "Isaac", PROFILE, 0);
    store.setEmail("u1", "Isaac@Example.com");
    expect(store.accountByEmail("isaac@example.COM")?.id).toBe("u1");
  });

  // Recovery sends a code to an email and signs into whichever account owns
  // it. Two owners would make that ambiguous — or a takeover.
  it("refuse an email another account already has", () => {
    store.createAccount("u1", "A", PROFILE, 0);
    store.createAccount("u2", "B", PROFILE, 0);
    store.setEmail("u1", "a@example.com");
    expect(store.setEmail("u2", "A@example.com")).toBe("taken");
    expect(store.setEmail("u1", "a@example.com")).not.toBe("taken");
  });

  it("delete everything they own in auth", () => {
    store.createAccount("u1", "A", PROFILE, 0);
    store.addPasskey({ id: "k1", userId: "u1", publicKey: new Uint8Array([1]), counter: 0 }, 0);
    store.createSession("h1", "u1", 0);
    store.deleteAccount("u1");
    expect(store.account("u1")).toBeNull();
    expect(store.passkey("k1")).toBeNull();
    expect(store.session("h1", 1)).toBeNull();
  });
});

describe("passkeys", () => {
  it("store the public key as bytes and the transports as a list", () => {
    store.addPasskey(
      { id: "k1", userId: "u1", publicKey: new Uint8Array([1, 2, 3]), counter: 4, transports: ["internal"] },
      0,
    );
    const key = store.passkey("k1")!;
    expect([...key.publicKey]).toEqual([1, 2, 3]);
    expect(key).toMatchObject({ userId: "u1", counter: 4, transports: ["internal"] });
    store.setPasskeyCounter("k1", 9);
    expect(store.passkey("k1")!.counter).toBe(9);
  });
});

describe("sessions", () => {
  it("resolve to their account until they expire", () => {
    store.createSession("h1", "u1", 0);
    expect(store.session("h1", 1)).toBe("u1");
    expect(store.session("h1", SESSION_TTL_MS)).toBeNull();
  });

  // Logged in once per device: a session that keeps being used never expires.
  it("slide forward with use", () => {
    store.createSession("h1", "u1", 0);
    const later = SESSION_TTL_MS - DAY;
    expect(store.session("h1", later)).toBe("u1");
    expect(store.session("h1", SESSION_TTL_MS + DAY)).toBe("u1");
  });

  it("can all be revoked, optionally keeping one", () => {
    store.createSession("h1", "u1", 0);
    store.createSession("h2", "u1", 0);
    store.createSession("h3", "u2", 0);
    store.deleteSessionsFor("u1", "h2");
    expect(store.session("h1", 1)).toBeNull();
    expect(store.session("h2", 1)).toBe("u1");
    store.deleteSessionsFor("u1");
    expect(store.session("h2", 1)).toBeNull();
    expect(store.session("h3", 1)).toBe("u2");
  });
});

describe("codes", () => {
  it("redeem once, for the account they were issued to", () => {
    store.issueCode("a@example.com", "recover", "u1", "hash", 0);
    expect(store.redeemCode("A@example.com", "recover", "hash", 1)).toEqual({ userId: "u1" });
    expect(store.redeemCode("a@example.com", "recover", "hash", 2)).toBeNull();
  });

  it("don't redeem across purposes", () => {
    store.issueCode("a@example.com", "verify-email", "u1", "hash", 0);
    expect(store.redeemCode("a@example.com", "recover", "hash", 1)).toBeNull();
  });

  it("expire", () => {
    store.issueCode("a@example.com", "recover", "u1", "hash", 0);
    expect(store.redeemCode("a@example.com", "recover", "hash", CODE_TTL_MS)).toBeNull();
  });

  // Six digits is a million guesses. The cap makes it five.
  it(`die after ${CODE_MAX_ATTEMPTS} wrong guesses, even if the next is right`, () => {
    store.issueCode("a@example.com", "recover", "u1", "hash", 0);
    for (let i = 0; i < CODE_MAX_ATTEMPTS; i++) {
      expect(store.redeemCode("a@example.com", "recover", `wrong${i}`, 1)).toBeNull();
    }
    expect(store.redeemCode("a@example.com", "recover", "hash", 1)).toBeNull();
  });

  it("are replaced by a newer code", () => {
    store.issueCode("a@example.com", "recover", "u1", "old", 0);
    store.issueCode("a@example.com", "recover", "u1", "new", 1);
    expect(store.redeemCode("a@example.com", "recover", "old", 2)).toBeNull();
  });

  it(`are capped at ${CODES_PER_HOUR} an hour per email`, () => {
    for (let i = 0; i < CODES_PER_HOUR; i++) {
      expect(store.issueCode("a@example.com", "recover", "u1", `h${i}`, i)).toBe("ok");
    }
    expect(store.issueCode("a@example.com", "recover", "u1", "more", 10)).toBe("rate-limited");
    expect(store.issueCode("b@example.com", "recover", "u2", "other", 10)).toBe("ok");
    expect(store.issueCode("a@example.com", "recover", "u1", "later", 60 * 60 * 1000 + 10)).toBe("ok");
  });
});
