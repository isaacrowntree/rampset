import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Account } from "@/db/account";

const adopt = vi.fn(async (_: Account) => {});
vi.mock("@/state/UserContext", () => ({ useUser: () => ({ adopt }) }));

const ACCOUNT: Account = {
  id: "u_new",
  name: "Silvana",
  email: null,
  profile: { unit: "kg", templateId: "routine", accent: "blue", theme: "light" },
};

const auth = {
  authConfig: vi.fn(async () => ({ accounts: true, email: true, turnstileSiteKey: null })),
  createAccount: vi.fn(async () => ACCOUNT),
  signInWithPasskey: vi.fn(async () => ACCOUNT),
  passkeysSupported: () => true,
};
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<object>()), ...auth }));

const { Onboarding } = await import("./Onboarding");

beforeEach(() => vi.clearAllMocks());

describe("Onboarding", () => {
  it("still offers the recovery email when the config arrives late", async () => {
    let arrive!: () => void;
    auth.authConfig.mockReturnValueOnce(
      new Promise((r) => (arrive = () => r({ accounts: true, email: true, turnstileSiteKey: null }))),
    );
    render(<Onboarding />);
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Your name" }), "Silvana");
    await userEvent.click(screen.getByRole("button", { name: "Create with passkey" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(adopt).not.toHaveBeenCalled();
    arrive();
    expect(await screen.findByRole("heading", { name: "Add a recovery email" })).toBeInTheDocument();
  });

  // Dismissing the passkey sheet is a choice, not a failure: no red error,
  // and the form is ready to go again.
  it("treats a dismissed passkey prompt as no error", async () => {
    const { AuthError } = await import("@/lib/auth");
    auth.createAccount.mockRejectedValueOnce(new AuthError("Cancelled.", 0, "cancelled"));
    render(<Onboarding />);
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Your name" }), "Silvana");
    await userEvent.click(screen.getByRole("button", { name: "Create with passkey" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create with passkey" })).toBeEnabled());
    expect(screen.queryByText("Cancelled.")).not.toBeInTheDocument();
  });

  it("shows a real failure", async () => {
    const { AuthError } = await import("@/lib/auth");
    auth.createAccount.mockRejectedValueOnce(new AuthError("You're offline — connect and try again."));
    render(<Onboarding />);
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Your name" }), "Silvana");
    await userEvent.click(screen.getByRole("button", { name: "Create with passkey" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You're offline");
  });

  it("starts on this device when the server has no accounts", async () => {
    auth.authConfig.mockResolvedValueOnce({ accounts: false, email: false, turnstileSiteKey: null });
    render(<Onboarding />);
    await userEvent.click(await screen.findByRole("button", { name: "Start on this device" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Your name" }), "Dev");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ name: "Dev", id: expect.stringMatching(/^local_/) })),
    );
    expect(auth.createAccount).not.toHaveBeenCalled();
  });
});
