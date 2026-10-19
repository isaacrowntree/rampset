/** Choosing how to train, and shaping a free-form routine in the app. */
import { test, expect } from "./fixtures";
import { createAccount, signInWithPasskey } from "./steps";

test("Silvana builds her own routine, and it follows her to her other phone", async ({ phone }) => {
  const p = await phone();
  await createAccount(p.page, "Silvana", "Custom routine");
  await p.page.getByRole("navigation").getByRole("link", { name: "Program" }).click();

  // Name the first day and fill it.
  await p.page.getByRole("button", { name: "Edit day Day 1" }).click();
  await p.page.getByRole("textbox", { name: "Day name" }).fill("Glutes");
  await p.page.getByRole("button", { name: "Done" }).click();
  for (const name of ["Hip thrust", "Bulgarian split squat"]) {
    await p.page.getByRole("button", { name: "Add exercise" }).first().click();
    await p.page.getByPlaceholder("Exercise name").fill(name);
    await p.page.getByRole("dialog").getByRole("button", { name: "Add exercise" }).click();
  }
  // Bulgarians first.
  await p.page.getByRole("button", { name: "Edit Bulgarian split squat" }).click();
  await p.page.getByRole("button", { name: "Move up" }).click();
  await p.page.getByRole("button", { name: "Done" }).click();

  // A second day.
  await p.page.getByRole("button", { name: "Add day" }).click();
  await p.page.getByRole("textbox", { name: "Day name" }).fill("Upper");
  await p.page.getByRole("dialog").getByRole("button", { name: "Add day" }).click();
  await expect(p.page.getByRole("heading", { name: "Upper" })).toBeVisible();

  // Home leads with her first day, in her order.
  await p.page.getByRole("navigation").getByRole("link", { name: "Home" }).click();
  await expect(p.page.getByRole("link", { name: "Start Glutes" })).toBeVisible();
  const nextCard = p.page.locator("section").filter({ has: p.page.getByRole("heading", { name: "Glutes" }) });
  await expect(nextCard.getByRole("listitem").first()).toContainText("Bulgarian split squat");

  // The program travels by the cloud backup, which follows edits within seconds.
  await p.page.waitForResponse(
    (r) => r.url().endsWith("/api/backup") && r.request().method() === "POST" && r.ok(),
    { timeout: 15_000 },
  );
  const other = await phone();
  await p.sharePasskeysWith(other);
  await signInWithPasskey(other.page);
  await other.page.getByRole("navigation").getByRole("link", { name: "Program" }).click();
  await expect(other.page.getByRole("heading", { name: "Glutes" })).toBeVisible();
  await expect(other.page.getByRole("heading", { name: "Upper" })).toBeVisible();
});

test("a guided program can be switched later without losing history", async ({ phone }) => {
  const p = await phone();
  await createAccount(p.page, "Isaac", "Madcow 5×5");
  await expect(p.page.getByRole("heading", { name: /Monday/ })).toBeVisible();
  await p.page.getByRole("navigation").getByRole("link", { name: "Settings" }).click();
  await p.page.getByRole("button", { name: /^StrongLifts 5×5 The original/ }).click();
  await p.page.getByRole("alertdialog").getByRole("button", { name: "Switch program" }).click();
  await p.page.getByRole("navigation").getByRole("link", { name: "Home" }).click();
  await expect(p.page.getByRole("heading", { name: "Workout A" })).toBeVisible();
});
