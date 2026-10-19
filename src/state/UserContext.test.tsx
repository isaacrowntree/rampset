import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
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
vi.mock("@/lib/auth", () => ({ currentAccount: () => currentAccount() }));
// A new device restores from the cloud; these specs have no cloud.
vi.mock("@/lib/cloudBackup", () => ({ getLatestCloudBackup: async () => null }));

const { UserProvider, useUser } = await import("./UserContext");

function Probe() {
  const { user, ready, session } = useUser();
  return <p data-testid="probe">{ready ? `${user?.id ?? "none"}:${session}` : "booting"}</p>;
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

describe("booting a device with no account", () => {
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
