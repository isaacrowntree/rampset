import { describe, it, expect, beforeEach } from "vitest";
import { setAccessIdentity, mayWriteAs } from "./identityGate";

beforeEach(() => {
  localStorage.clear();
  setAccessIdentity(null);
});

describe("mayWriteAs", () => {
  it("allows the avatar whose email matches the Access session", () => {
    setAccessIdentity("isaac@example.com");
    expect(mayWriteAs("isaac@example.com")).toBe(true);
  });

  it("is case-insensitive about the match", () => {
    setAccessIdentity("Isaac@Example.com");
    expect(mayWriteAs("isaac@example.com")).toBe(true);
  });

  // /api/sync and /api/backup are BOTH routed by the server-side Access email,
  // while the rows they carry belong to whichever avatar is selected on this
  // device. Finish a workout as someone else and their data is written into
  // YOUR journal and YOUR latest.json. The switcher is one tap away.
  it("refuses to write another avatar's data under this Access session", () => {
    setAccessIdentity("isaac@example.com");
    expect(mayWriteAs("someone-else@example.com")).toBe(false);
  });

  // /api/me has a 2s timeout and falls back to a saved selection, so an
  // unknown identity is routine (cold launch, flaky network). Blocking sync
  // then would strand a device that is almost certainly fine — and the server
  // is the real authority either way.
  it("allows writes when the Access identity could not be resolved", () => {
    setAccessIdentity(null);
    expect(mayWriteAs("isaac@example.com")).toBe(true);
  });
});

/** /api/me has a 2s timeout and a cold mobile network blows it routinely, so
 * "unresolved" is a normal state — but the identity itself changes almost
 * never. Falling back to the last one we DID resolve is strictly better than
 * opening the gate on a flaky request. */
describe("remembering the resolved identity", () => {
  it("falls back to the last resolved identity when /api/me fails", () => {
    setAccessIdentity("isaac@example.com"); // a launch where it worked
    setAccessIdentity(null); // next launch: /api/me timed out

    expect(mayWriteAs("isaac@example.com")).toBe(true);
    expect(mayWriteAs("someone-else@example.com")).toBe(false); // still guarded
  });

  it("still allows writes on a device that has never resolved one", () => {
    setAccessIdentity(null);
    expect(mayWriteAs("anyone@example.com")).toBe(true);
  });

  it("a newly resolved identity replaces the remembered one", () => {
    setAccessIdentity("old@example.com");
    setAccessIdentity("new@example.com");
    setAccessIdentity(null);

    expect(mayWriteAs("new@example.com")).toBe(true);
    expect(mayWriteAs("old@example.com")).toBe(false);
  });
});
