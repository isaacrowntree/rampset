"use client";

/** The install offer's state: Chromium's deferred prompt, whether the app is
 * already installed, and whether this device said "not now".
 *
 * Imported by the app shell so the listeners exist from boot: Chromium fires
 * `beforeinstallprompt` once, early — often during onboarding, long before
 * Home (where the card lives) mounts. */

import { useSyncExternalStore } from "react";
import { installRoute, type InstallRoute } from "./install";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const KEY = "liftlog.installDismissed";
const listeners = new Set<() => void>();
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;

function emit() {
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Hold the browser's own banner back; the card's button shows it.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  // Installed by any route — the card's button or the browser's own menu.
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function snapshot(): InstallRoute | null {
  if (installed || dismissed()) return null;
  return installRoute({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    canPrompt: deferred !== null,
    standalone:
      matchMedia("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true,
  });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** How to offer installing on this device, or null for no offer. */
export function useInstallRoute(): InstallRoute | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** "Not now", for good on this device. */
export function dismissInstall(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // storage blocked — the card will be back next launch
  }
  emit();
}

/** Show the browser's install dialog. A prompt is single-use: whatever the
 * answer, the card hides until the browser offers another. */
export async function promptInstall(): Promise<void> {
  const e = deferred;
  if (!e) return;
  deferred = null;
  emit();
  await e.prompt();
  if ((await e.userChoice).outcome === "accepted") installed = true;
  emit();
}
