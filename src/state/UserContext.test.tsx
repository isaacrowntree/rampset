import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "@/db/db";
import { adoptAccount, type Account } from "@/db/account";
import { mayWriteAs, setSessionAccount } from "@/lib/identityGate";
import type { Account as A } from "@/db/account";

const ACCOUNT: Account = {
  id: "u_me",
  name: "Isaac",
  email: null,
  profile: { unit: "kg", templateId: "madcow", accent: "blue", theme: "dark" },
};

const currentAccount = vi.fn<() => Promise<A | null | undefined>>();
const updateProfile = vi.fn(async (patch: { profile: Partial<A["profile"]> }) => ({
  ...ACCOUNT,
  profile: { ...ACCOUNT.profile, ...patch.profile },
}));
vi.mock("@/lib/auth", () => ({
  currentAccount: () => currentAccount(),
  updateProfile: (p: { profile: Partial<A["profile"]> }) => updateProfile(p),
}));
// A new device restores from the cloud; these specs have no cloud.
vi.mock("@/lib/cloudBackup", () => ({ getLatestCloudBackup: async () => null }));

const { UserProvider, useUser } = await import("./UserContext");

function ThemeSetter() {
  const { patchUser, ready } = useUser();
  return ready ? <button onClick={() => void patchUser({ theme: "light" })}>light</button> : null;
}

const seen: string[] = [];
function Probe() {
  const { user, ready, session } = useUser();
  const state = ready ? `${user?.id ?? "none"}:${session}` : "booting";
  seen.push(state);
  return <p data-testid="probe">{state}</p>;
}

const boot = () =>
  render(
    <UserProvider>
      <Probe />
    </UserProvider>,
  );
const probe = () => screen.getByTestId("probe").textContent;

beforeEach(async () => {
  await db.delete();
  await db.open();
  localStorage.clear();
  setSessionAccount(null);
  currentAccount.mockReset();
  updateProfile.mockClear();
  seen.length = 0;
});

describe("booting a device that has an account", () => {
  beforeEach(async () => {
    await adoptAccount(ACCOUNT);
    setSessionAccount(ACCOUNT.id);
  });

  // The gym has no signal. The app is local; a failed session check must
  // neither block it nor stop the workouts syncing once the network returns.
  it("opens offline, still allowed to sync as itself", async () => {
    currentAccount.mockResolvedValue(undefined);
    boot();
    await waitFor(() => expect(probe()).toBe("u_me:unknown"));
    expect(mayWriteAs("u_me")).toBe(true);
  });

  it("confirms the session when the server agrees", async () => {
    currentAccount.mockResolvedValue({ ...ACCOUNT, name: "Isaac R" });
    boot();
    await waitFor(() => expect(probe()).toBe("u_me:signed-in"));
    // Renamed on another device — picked up here.
    expect((await db.users.get("u_me"))?.name).toBe("Isaac R");
  });

  it("pauses sync when the server says signed out — keeping the data", async () => {
    currentAccount.mockResolvedValue(null);
    boot();
    await waitFor(() => expect(probe()).toBe("u_me:signed-out"));
    expect(mayWriteAs("u_me")).toBe(false);
    expect(await db.programs.where({ userId: "u_me" }).count()).toBe(1);
  });

  // The cookie belongs to someone else (signed in as them in another tab).
  // Pushing now would file this device's workouts in their journal.
  it("refuses to sync under a session for a different account", async () => {
    currentAccount.mockResolvedValue({ ...ACCOUNT, id: "u_other" });
    boot();
    await waitFor(() => expect(probe()).toBe("u_me:signed-out"));
    expect(mayWriteAs("u_me")).toBe(false);
  });
});

// A skin chosen offline is this phone's choice until the account has it. The
// next online launch must send it up, not take the server's old one down.
describe("a theme changed offline", () => {
  it("survives the next online launch, and reaches the account", async () => {
    await adoptAccount(ACCOUNT);
    setSessionAccount(ACCOUNT.id);
    currentAccount.mockResolvedValue(undefined); // offline
    updateProfile.mockRejectedValueOnce(new Error("offline"));
    const { unmount } = render(
      <UserProvider>
        <ThemeSetter />
      </UserProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "light" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    unmount();

    updateProfile.mockClear();
    currentAccount.mockResolvedValue(ACCOUNT); // online again; the server still says dark
    boot();
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ profile: { theme: "light" } }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
  });
});

describe("booting a device with no account", () => {
  // Onboarding shown while a live session is still being adopted would let
  // someone start a second account on top of it.
  it("adopts a quick live session without flashing onboarding", async () => {
    currentAccount.mockImplementation(() => new Promise((r) => setTimeout(() => r(ACCOUNT), 300)));
    boot();
    await waitFor(() => expect(probe()).toBe("u_me:signed-in"));
    expect(seen).not.toContain("none:unknown");
  });

  it("shows onboarding when nobody is signed in", async () => {
    currentAccount.mockResolvedValue(null);
    boot();
    await waitFor(() => expect(probe()).toBe("none:unknown"));
  });

  it("adopts a live session, building the account's program", async () => {
    currentAccount.mockResolvedValue(ACCOUNT);
    boot();
    await waitFor(() => expect(probe()).toBe("u_me:signed-in"));
    expect(await db.programs.get("program-madcow-u_me")).toMatchObject({ mode: "madcow" });
    expect(mayWriteAs("u_me")).toBe(true);
  });
});
