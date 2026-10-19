import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "@/db/db";
import { seedIfEmpty } from "@/test/seed";
import type { Account } from "@/db/account";
import type { User } from "@/lib/types";

const ME: User = { id: "user-1", name: "Lifter One", email: "", accent: "blue", unit: "kg", theme: "dark" };
const ACCOUNT: Account = {
  id: "user-1",
  name: "Lifter One",
  email: null,
  profile: { unit: "kg", templateId: "5x5", accent: "blue", theme: "dark" },
};

const ctx = {
  user: ME,
  ready: true,
  session: "signed-in" as "signed-in" | "signed-out" | "unknown",
  adopt: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  patchUser: vi.fn(async () => {}),
  leave: vi.fn(async () => {}),
};
vi.mock("@/state/UserContext", () => ({ useUser: () => ctx }));

const auth = {
  authConfig: vi.fn(async () => ({ email: true, turnstileSiteKey: null })),
  signOut: vi.fn(async () => ({})),
  deleteAccount: vi.fn(async () => ({})),
  updateProfile: vi.fn(async (patch: Partial<Account>) => ({ ...ACCOUNT, ...patch })),
  signInWithPasskey: vi.fn(async () => ACCOUNT),
};
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<object>()), ...auth }));
vi.mock("@/lib/backupAfterEdit", () => ({ scheduleBackup: vi.fn() }));
vi.mock("@/components/SyncStatusRow", () => ({ SyncStatusRow: () => null }));

const { default: SettingsPage } = await import("./page");

beforeEach(async () => {
  vi.clearAllMocks();
  ctx.session = "signed-in";
  ctx.user = ME;
  await db.delete();
  await db.open();
  await seedIfEmpty();
});

const file = (name: string, text: string, type = "text/csv") => new File([text], name, { type });

describe("Settings — account", () => {
  it("shows who's signed in and offers a recovery email", async () => {
    render(<SettingsPage />);
    expect(await screen.findByText("Lifter One")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Add recovery email/ })).toBeInTheDocument();
  });

  // Signing out wipes the device — the outbox holds the ONLY copy of a
  // workout that hasn't synced, so the warning has to say so.
  it("warns before signing out loses unsynced workouts, then signs out and clears the device", async () => {
    await db.outbox.add({ userId: "user-1", opId: "w1", kind: "finishedWorkout", payload: {} });
    render(<SettingsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    const sheet = await screen.findByRole("alertdialog");
    expect(sheet).toHaveTextContent(/1 workout hasn.t synced/);
    await userEvent.click(within(sheet).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(ctx.leave).toHaveBeenCalled());
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("deletes the account only after confirming", async () => {
    render(<SettingsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete account" }));
    const sheet = await screen.findByRole("alertdialog");
    expect(auth.deleteAccount).not.toHaveBeenCalled();
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete account" }));
    await waitFor(() => expect(ctx.leave).toHaveBeenCalled());
    expect(auth.deleteAccount).toHaveBeenCalled();
  });

  it("switches the theme and saves it to the account", async () => {
    render(<SettingsPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "Light" }));
    expect(ctx.patchUser).toHaveBeenCalledWith({ theme: "light" });
    await waitFor(() =>
      expect(auth.updateProfile).toHaveBeenCalledWith({ profile: expect.objectContaining({ theme: "light" }) }),
    );
  });

  // Offline-first: a skin is a local choice; the server catches up later.
  it("switches the theme offline too, without an error", async () => {
    auth.updateProfile.mockRejectedValueOnce(new Error("offline"));
    render(<SettingsPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "Light" }));
    expect(ctx.patchUser).toHaveBeenCalledWith({ theme: "light" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Settings — signed out", () => {
  beforeEach(() => {
    ctx.session = "signed-out";
  });

  // Nothing here can reach the server until they sign in again.
  it("offers no account deletion or cloud backup", async () => {
    render(<SettingsPage />);
    await screen.findByText("Signed out — sync and backup are paused");
    expect(screen.queryByRole("button", { name: "Delete account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back up to cloud/ })).not.toBeInTheDocument();
  });

  it("says sync is paused and signs back in", async () => {
    render(<SettingsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Sign in/ }));
    await waitFor(() => expect(ctx.adopt).toHaveBeenCalledWith(ACCOUNT));
  });

  // One account per device: a passkey for someone else must not quietly
  // replace this device's data.
  it("refuses a passkey that belongs to another account", async () => {
    auth.signInWithPasskey.mockResolvedValueOnce({ ...ACCOUNT, id: "u_other" });
    render(<SettingsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Sign in/ }));
    expect(await screen.findByText(/different account/)).toBeInTheDocument();
    expect(ctx.adopt).not.toHaveBeenCalled();
  });
});

// `next dev`, or a self-host without accounts: the app lives on the device.
describe("Settings — a device-only account", () => {
  beforeEach(() => {
    ctx.user = { ...ME, id: "local_abc" };
  });

  it("says so, and offers erasing the device instead of account actions", async () => {
    render(<SettingsPage />);
    expect(await screen.findByText(/On this device only/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erase this device" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Restore from cloud/ })).not.toBeInTheDocument();
  });
});

describe("Settings — your data", () => {
  const SL = `Date (yyyy/mm/dd),Workout,Workout Name,Program Name,Body Weight (KG),Exercise,SetsxReps,SetsxTime,Top Set Reps x KG,e1RM  (KG),Reps,Volume (KG),Workout Volume (KG),Duration (hours),Start Time (h:mm),End Time (h:mm),Notes,Set 1 (Reps), Set 1 (KG)
"2015/05/25","1","Workout A","","87","Squat","1x5","","5x20","24.7","5","100","","1","7:37 PM","8:37 PM","","5","20"
"2015/05/27","2","Workout B","","87","Squat","1x5","","5x22.5","24.7","5","100","","1","7:37 PM","8:37 PM","","5","22.5"`;

  // Import adds history and can't be undone with a tap, so it shows what it
  // found before it writes anything.
  it("imports a StrongLifts export after showing what it found", async () => {
    render(<SettingsPage />);
    await userEvent.upload(await screen.findByLabelText("Import from another app"), file("sl.csv", SL));
    const sheet = await screen.findByRole("alertdialog");
    expect(sheet).toHaveTextContent(/2 workouts from StrongLifts/);
    expect(await db.workouts.where({ userId: "user-1" }).count()).toBe(0);
    await userEvent.click(within(sheet).getByRole("button", { name: "Import" }));
    await waitFor(async () => expect(await db.workouts.where({ userId: "user-1" }).count()).toBe(2));
  });

  it("explains a file it can't read instead of importing it", async () => {
    render(<SettingsPage />);
    await userEvent.upload(await screen.findByLabelText("Import from another app"), file("x.csv", "a,b\n1,2"));
    expect(await screen.findByText(/doesn.t look like a StrongLifts or Strong export/)).toBeInTheDocument();
  });

  it("restores a backup file made under another account", async () => {
    const { exportBackup } = await import("@/db/backup");
    await db.workouts.add({ id: "w-old", userId: "user-2", dayLabel: "Day 1", date: "2026-01-01" });
    const json = await exportBackup("user-2");
    // It came from another device: this one never held user-2's rows.
    await db.workouts.delete("w-old");

    render(<SettingsPage />);
    await userEvent.upload(await screen.findByLabelText("Restore from backup file"), file("b.json", json, "application/json"));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /Replace/ }));
    await waitFor(async () => expect(await db.workouts.get("w-old")).toMatchObject({ userId: "user-1" }));
  });
});
