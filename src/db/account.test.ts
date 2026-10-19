import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "./db";
import { adoptAccount, legacyProfiles, localUser, moveLegacyProfile, type Account } from "./account";

const ACCOUNT: Account = {
  id: "u_me",
  name: "Isaac",
  email: null,
  profile: { unit: "kg", templateId: "5x5", accent: "blue", theme: "dark" },
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("adoptAccount", () => {
  // Template ids embed the account id, so two devices build identical rows —
  // which is what lets a synced op on one land on the other's slots.
  it("builds the chosen program under ids every device agrees on", async () => {
    await adoptAccount(ACCOUNT);
    expect(await db.programDays.get("day-5x5-a-u_me")).toBeDefined();
    expect(await db.exercises.get("ex-u_me-squat")).toBeDefined();
  });

  it("starts a custom routine as one empty day", async () => {
    await adoptAccount({ ...ACCOUNT, profile: { ...ACCOUNT.profile, templateId: "routine" } });
    const days = await db.programDays.where({ programId: "program-routine-u_me" }).toArray();
    expect(days.map((d) => d.name)).toEqual(["Day 1"]);
    expect(await db.programExercises.count()).toBe(0);
  });

  // Every launch re-adopts the server's copy of the account. That must
  // refresh the name, never reset a program the lifter has since edited.
  it("on a second adopt, refreshes identity and leaves the program alone", async () => {
    await adoptAccount(ACCOUNT);
    await db.programExercises.update("pe-day-5x5-a-u_me-0", { workingWeightKg: 100 });
    await adoptAccount({ ...ACCOUNT, name: "Isaac R" });
    expect((await db.users.get("u_me"))?.name).toBe("Isaac R");
    expect((await db.programExercises.get("pe-day-5x5-a-u_me-0"))?.workingWeightKg).toBe(100);
  });
});

/** A phone from before accounts: the household's lifters, seeded from config
 * under ids like user-1 and user-2, each with history. */
describe("a device from before accounts", () => {
  beforeEach(async () => {
    const { seedIfEmpty } = await import("@/test/seed");
    await seedIfEmpty();
    // Workout ids are random — they never embed their owner.
    await db.workouts.add({ id: "wk1", userId: "user-1", dayLabel: "Day", date: "2026-01-01", startTs: 1, endTs: 2 });
    await db.workouts.add({ id: "wk2", userId: "user-2", dayLabel: "Day", date: "2026-01-01", startTs: 1, endTs: 2 });
  });

  // Not this device's account — so onboarding shows, rather than a signed-out
  // state no passkey can ever get out of.
  it("has no account of its own until one is adopted", async () => {
    expect(await localUser()).toBeNull();
    await adoptAccount(ACCOUNT);
    expect((await localUser())?.id).toBe("u_me");
  });

  it("lists the old profiles and what they hold", async () => {
    expect(await legacyProfiles()).toEqual([
      expect.objectContaining({ id: "user-1", name: "Lifter One", workouts: 1 }),
      expect.objectContaining({ id: "user-2", name: "Lifter Two", workouts: 1 }),
    ]);
  });

  // Moving one lifter's history must not touch the other's: on a shared
  // phone, that's someone else's data.
  it("moves one old profile's history into the account, leaving the other", async () => {
    await adoptAccount(ACCOUNT);
    const moved = await moveLegacyProfile("user-1", "u_me");
    expect(moved.workoutIds).toEqual(["wk1"]);
    expect(await db.workouts.get("wk1")).toMatchObject({ userId: "u_me" });
    expect(await db.exercises.get("ex-u_me-squat")).toBeDefined();
    expect(await db.users.get("user-1")).toBeUndefined();
    expect(await db.exercises.where({ userId: "user-1" }).count()).toBe(0);
    expect((await legacyProfiles()).map((p) => p.id)).toEqual(["user-2"]);
    expect(await db.workouts.get("wk2")).toMatchObject({ userId: "user-2" });
  });
});
