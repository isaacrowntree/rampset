import { describe, it, expect, beforeEach } from "vitest";
import { setSessionAccount, mayWriteAs } from "./identityGate";

beforeEach(() => {
  localStorage.clear();
  setSessionAccount(null);
});

describe("mayWriteAs", () => {
  it("allows the account the server confirmed", () => {
    setSessionAccount("u_me");
    expect(mayWriteAs("u_me")).toBe(true);
  });

  // The routes file data under the session cookie's account. If that is no
  // longer this device's account, a push would land in someone else's log.
  it("refuses to write as any other account", () => {
    setSessionAccount("u_me");
    expect(mayWriteAs("u_someone")).toBe(false);
  });

  it("refuses everything once signed out", () => {
    setSessionAccount("u_me");
    setSessionAccount(null);
    expect(mayWriteAs("u_me")).toBe(false);
  });

  // A session check that fails (offline, timeout) is not evidence of a
  // different account — keep writing as the one we last confirmed.
  it("keeps the last confirmed account when the check can't tell", () => {
    setSessionAccount("u_me");
    setSessionAccount(undefined);
    expect(mayWriteAs("u_me")).toBe(true);
  });

  it("remembers the confirmed account across reloads", async () => {
    setSessionAccount("u_me");
    expect(localStorage.getItem("liftlog.sessionAccount")).toBe("u_me");
  });
});
