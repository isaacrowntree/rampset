import { describe, expect, it } from "vitest";
import { securityNotice } from "./securityNotice";

function harness(recovery: string | null = "lifter@example.com") {
  const sent: { to: string; subject: string; text: string; html: string }[] = [];
  const notify = securityNotice({
    email: { send: async (m) => void sent.push(m) },
    from: "noreply@example.com",
    recoveryEmail: async () => recovery,
  });
  return { sent, notify };
}

describe("security notices", () => {
  it("tells the recovery address when a passkey is added or removed", async () => {
    const { sent, notify } = harness();
    await notify("u1", { type: "passkey-added", passkeyId: "k2" });
    await notify("u1", { type: "passkey-removed", passkeyId: "k1" });
    expect(sent.map((m) => [m.to, m.subject])).toEqual([
      ["lifter@example.com", "A passkey was added to your Rampset account"],
      ["lifter@example.com", "A passkey was removed from your Rampset account"],
    ]);
    expect(sent[0]!.text).toMatch(/If this wasn't you/);
  });

  it("sends nothing for an account with no recovery email", async () => {
    const { sent, notify } = harness(null);
    await notify("u1", { type: "passkey-added", passkeyId: "k2" });
    expect(sent).toEqual([]);
  });

  // The old inbox belongs to whoever might not have made the change.
  it("reports a changed email to the address it replaced, and not a first one", async () => {
    const { sent, notify } = harness();
    await notify("u1", { type: "email-changed", email: "new@example.com", previous: null });
    await notify("u1", { type: "email-changed", email: "<b>new</b>@example.com", previous: "old@example.com" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("old@example.com");
    expect(sent[0]!.text).toContain("<b>new</b>@example.com");
    expect(sent[0]!.html).toContain("&lt;b&gt;new&lt;/b&gt;@example.com");
  });

  it("tells the address an account was recovered through", async () => {
    const { sent, notify } = harness(null);
    await notify("u1", { type: "recovered", email: "lifter@example.com" });
    expect(sent.map((m) => [m.to, m.subject])).toEqual([["lifter@example.com", "Your Rampset account was recovered"]]);
  });
});
