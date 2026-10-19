import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "@/db/db";
import { seedIfEmpty, TEST_USERS } from "@/test/seed";
import type { User } from "@/lib/types";

/** The page reads the account from context; these specs pick which. */
let current: User;
vi.mock("@/state/UserContext", () => ({ useUser: () => ({ user: current, ready: true }) }));
vi.mock("@/lib/backupAfterEdit", () => ({ scheduleBackup: () => {} }));

const { default: ProgramPage } = await import("./page");

const asUser = (id: string): User => {
  const cfg = TEST_USERS.find((u) => u.id === id)!;
  return { id: cfg.id, name: cfg.name, email: cfg.email, accent: cfg.accent, unit: cfg.unit };
};

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedIfEmpty();
});

describe("Program tab — a custom routine", () => {
  beforeEach(() => {
    current = asUser("user-2");
  });

  it("adds a day", async () => {
    render(<ProgramPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Add day" }));
    const sheet = await screen.findByRole("dialog", { name: "New day" });
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Day name" }), "Upper");
    await userEvent.click(within(sheet).getByRole("button", { name: "Add day" }));
    expect(await screen.findByRole("heading", { name: "Upper" })).toBeInTheDocument();
  });

  it("renames and deletes a day from its header", async () => {
    render(<ProgramPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Edit day Day 1/ }));
    const sheet = await screen.findByRole("dialog", { name: /Edit day/ });
    const field = within(sheet).getByRole("textbox", { name: "Day name" });
    await userEvent.clear(field);
    await userEvent.type(field, "Legs");
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("heading", { name: "Legs" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Edit day Legs/ }));
    const again = await screen.findByRole("dialog", { name: /Edit day/ });
    await userEvent.click(within(again).getByRole("button", { name: "Delete day" }));
    await userEvent.click(within(again).getByRole("button", { name: /tap to confirm/ }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Legs" })).not.toBeInTheDocument());
  });

  // With no days, Home has nothing to start — the routine is a dead end.
  it("won't delete the only day left", async () => {
    await db.programDays.where("id").anyOf(["day-routine-2-user-2", "day-routine-3-user-2"]).delete();
    render(<ProgramPage />);
    await userEvent.click(await screen.findByRole("button", { name: /Edit day Day 1/ }));
    const sheet = await screen.findByRole("dialog", { name: /Edit day/ });
    expect(within(sheet).queryByRole("button", { name: "Delete day" })).not.toBeInTheDocument();
  });

  it("moves an exercise up its day", async () => {
    render(<ProgramPage />);
    const day = (await screen.findByRole("heading", { name: /Day 1/ })).closest("section")!;
    const rows = () => within(day).getAllByRole("button", { name: /^Edit (?!day)/ }).map((b) => b.textContent);
    const second = rows()[1];
    await userEvent.click(within(day).getAllByRole("button", { name: /^Edit (?!day)/ })[1]);
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(rows()[0]).toBe(second));
  });
});

// 5×5 and Madcow rotate through their written days and progress by them, so
// their structure isn't free-form.
describe("Program tab — a guided program", () => {
  beforeEach(() => {
    current = asUser("user-1");
  });

  it("offers no day editing", async () => {
    render(<ProgramPage />);
    await screen.findByRole("heading", { name: "Workout A" });
    expect(screen.queryByRole("button", { name: "Add day" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit day/ })).not.toBeInTheDocument();
  });
});
