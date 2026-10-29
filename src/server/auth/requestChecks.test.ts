import { describe, it, expect } from "vitest";
import { sameOrigin, wrongAccount } from "./requestChecks";

const post = (headers: Record<string, string>) =>
  new Request("https://rampset.app/api/sync", { method: "POST", headers });

describe("sameOrigin", () => {
  it("lets reads through", () => {
    expect(sameOrigin(new Request("https://rampset.app/api/sync", { headers: { origin: "https://evil.example" } }))).toBe(
      true,
    );
  });

  it("takes a write from our own origin, and refuses any other", () => {
    expect(sameOrigin(post({ origin: "https://rampset.app" }))).toBe(true);
    expect(sameOrigin(post({ origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(post({ origin: "null" }))).toBe(false);
  });

  // No Origin isn't a pass: the browser must say the request is same-origin.
  it("needs Sec-Fetch-Site: same-origin when a write carries no Origin", () => {
    expect(sameOrigin(post({}))).toBe(false);
    expect(sameOrigin(post({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(sameOrigin(post({ "sec-fetch-site": "same-origin" }))).toBe(true);
  });
});

describe("wrongAccount", () => {
  it("passes a request naming the session's account", () => {
    expect(wrongAccount(post({ "x-account": "u_a" }), "u_a")).toBeNull();
  });

  // A tab still holding A after someone else signed in here: its rows must
  // not be filed under B. 409 carries no seq, so the outbox keeps them.
  it("refuses one naming another account, or none", async () => {
    for (const headers of [{ "x-account": "u_a" }, {}] as Record<string, string>[]) {
      const res = wrongAccount(post(headers), "u_b");
      expect(res?.status).toBe(409);
      expect(await res?.json()).not.toHaveProperty("seq");
    }
  });
});
