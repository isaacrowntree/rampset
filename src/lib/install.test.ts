import { describe, it, expect } from "vitest";
import { installRoute, type InstallEnv } from "./install";

// Real user agents, as each browser sends them.
const UA = {
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  ipadSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  iosInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 401.0.0.27.81 (iPhone16,2; iOS 18_6; en_AU; en; scale=3.00; 1290x2796; 811459853)",
  iosGmailWebview:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0",
  androidFacebook:
    "Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP4A.250105.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/530.0.0.0;]",
  androidWebview:
    "Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP4A.250105.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0",
};

const env = (userAgent: string, over: Partial<InstallEnv> = {}): InstallEnv => ({
  userAgent,
  maxTouchPoints: /iPhone|Android/.test(userAgent) ? 5 : 0,
  canPrompt: false,
  standalone: false,
  ...over,
});

describe("installRoute", () => {
  it("offers nothing once installed", () => {
    expect(installRoute(env(UA.iosSafari, { standalone: true }))).toBeNull();
    expect(installRoute(env(UA.androidChrome, { canPrompt: true, standalone: true }))).toBeNull();
  });

  it("uses the browser's prompt wherever it has one", () => {
    expect(installRoute(env(UA.androidChrome, { canPrompt: true }))).toBe("prompt");
    expect(installRoute(env(UA.macChrome, { canPrompt: true }))).toBe("prompt");
  });

  it("waits for Chromium's prompt rather than guessing at its menu", () => {
    expect(installRoute(env(UA.androidChrome))).toBeNull();
    expect(installRoute(env(UA.macChrome))).toBeNull();
  });

  it("walks every iOS browser through Share → Add to Home Screen, iPad included", () => {
    expect(installRoute(env(UA.iosSafari))).toBe("ios");
    expect(installRoute(env(UA.iosChrome))).toBe("ios");
    expect(installRoute(env(UA.ipadSafari, { maxTouchPoints: 5 }))).toBe("ios");
  });

  it("sends in-app browsers out to a real one first", () => {
    expect(installRoute(env(UA.iosInstagram))).toBe("in-app-ios");
    expect(installRoute(env(UA.iosGmailWebview))).toBe("in-app-ios");
    expect(installRoute(env(UA.androidFacebook))).toBe("in-app-android");
    expect(installRoute(env(UA.androidWebview, { canPrompt: true }))).toBe("in-app-android");
  });

  it("points Firefox on Android and Safari on a Mac at their menus", () => {
    expect(installRoute(env(UA.androidFirefox))).toBe("android-menu");
    expect(installRoute(env(UA.macSafari))).toBe("mac-safari");
  });

  it("offers nothing where there's no way to install", () => {
    expect(installRoute(env(UA.macFirefox))).toBeNull();
  });
});
