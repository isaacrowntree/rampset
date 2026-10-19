/** How this browser installs a web app — which decides what the install card
 * says. Only Chromium (Chrome, Edge, Samsung Internet) has a prompt we can
 * call; everywhere else installing is a browser menu the lifter has to find,
 * and in-app browsers (Instagram, Facebook, the Google app …) can't install
 * at all. */

export type InstallRoute =
  /** A real Install button: Chromium handed us `beforeinstallprompt`. */
  | "prompt"
  /** iPhone/iPad: Share → Add to Home Screen (Safari, and Chrome/Firefox/Edge
   * there since iOS 16.4). */
  | "ios"
  /** Safari on a Mac: File → Add to Dock (Sonoma and later). */
  | "mac-safari"
  /** Android without the prompt (Firefox): ⋮ → Add to Home screen. */
  | "android-menu"
  /** An app's built-in browser: open the page in Safari/Chrome first. */
  | "in-app-ios"
  | "in-app-android";

export interface InstallEnv {
  userAgent: string;
  /** iPadOS reports a Mac user agent; touch points are the tell. */
  maxTouchPoints: number;
  /** A captured `beforeinstallprompt` is waiting. */
  canPrompt: boolean;
  /** Already running as the installed app. */
  standalone: boolean;
}

/** Social and mail apps' webviews name themselves in the user agent. */
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|LinkedInApp|Snapchat|TikTok|musical_ly|Bytedance|Twitter|MicroMessenger|Pinterest|GSA\//;

/** What to offer, or null for nothing (installed, or no way to install). */
export function installRoute(env: InstallEnv): InstallRoute | null {
  if (env.standalone) return null;
  const ua = env.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1);
  const android = /Android/.test(ua);

  // An in-app browser can't install even if it's Chromium underneath.
  // iOS webviews also drop the "Safari/" token that every real iOS browser
  // (Safari, CriOS, FxiOS, EdgiOS) keeps; Android ones carry "; wv)".
  if (ios && (IN_APP.test(ua) || !/Safari\//.test(ua))) return "in-app-ios";
  if (android && (IN_APP.test(ua) || /; wv\)/.test(ua))) return "in-app-android";

  if (env.canPrompt) return "prompt";
  if (ios) return "ios";
  if (android && /Firefox\//.test(ua)) return "android-menu";
  if (/Macintosh/.test(ua) && /Version\/[\d.]+.*Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua)) {
    return "mac-safari";
  }
  // Chromium before its prompt arrives (or after it's spent), desktop
  // Firefox (no install at all): say nothing.
  return null;
}
