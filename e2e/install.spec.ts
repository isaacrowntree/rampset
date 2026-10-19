/** Getting Rampset onto the home screen: each phone is told the one way it
 * can install, a new lifter sees it on Home, and it never nags — gone once
 * dismissed, never shown in the installed app. */
import { devices } from "@playwright/test";
import { test, expect } from "./fixtures";
import { createAccount } from "./steps";

const { defaultBrowserType: _a, ...pixel } = devices["Pixel 7"];
const { defaultBrowserType: _i, ...iphone } = devices["iPhone 15"];

test.describe("Android Chrome", () => {
  test.use({ contextOptions: pixel });

  test("the browser's install offer, made during onboarding, is Home's Install button", async ({ phone }) => {
    const p = await phone();
    // Chrome decides the app is installable on its own schedule — here, as
    // soon as the first page loads, long before there's an account or a Home.
    // Stand in for it with the event Chrome would fire.
    await p.context.addInitScript(() => {
      addEventListener("load", () => {
        const offer = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
          prompt: async () => {
            (window as { prompted?: boolean }).prompted = true;
          },
          userChoice: Promise.resolve({ outcome: "accepted" }),
        });
        dispatchEvent(offer);
      });
    });
    await createAccount(p.page, "Isaac");

    const card = p.page.getByRole("region", { name: "Install Rampset" });
    await card.getByRole("button", { name: "Install" }).click();
    expect(await p.page.evaluate(() => (window as { prompted?: boolean }).prompted)).toBe(true);
    await expect(card).toBeHidden();
  });
});

test.describe("iPhone Safari", () => {
  test.use({ contextOptions: iphone });

  test("Home shows the Share-sheet steps until dismissed, and for good after", async ({ phone }) => {
    const p = await phone();
    await createAccount(p.page, "Isaac");

    const card = p.page.getByRole("region", { name: "Add Rampset to your Home Screen" });
    await expect(card).toContainText("Share");
    await expect(card).toContainText("Add to Home Screen");
    await card.getByRole("button", { name: "Not now" }).click();
    await expect(card).toBeHidden();

    await p.page.reload();
    await expect(p.page.getByRole("heading", { name: "Next workout" })).toBeVisible();
    await expect(card).toBeHidden();
  });

  test("the installed app never offers to install itself", async ({ phone }) => {
    const p = await phone();
    // Launched from the Home Screen, iOS says so on navigator.standalone.
    await p.context.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
    await createAccount(p.page, "Isaac");

    await expect(p.page.getByRole("heading", { name: "Next workout" })).toBeVisible();
    await expect(p.page.getByRole("region", { name: /Rampset/ })).toHaveCount(0);
  });
});
