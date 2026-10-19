import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { db } from "./db";
import { adoptAccount, type Account } from "./account";

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
