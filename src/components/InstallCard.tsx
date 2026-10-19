"use client";

/** Home's "put Rampset on your phone" card, for a lifter still in a browser
 * tab. Says the one thing that works on this device — a real Install button
 * where the browser has one, the Share-sheet steps on iPhone, "open in
 * Safari/Chrome" inside an app's built-in browser — and goes for good once
 * dismissed or installed. */

import type { ReactNode } from "react";
import { dismissInstall, promptInstall, useInstallRoute } from "@/lib/installPrompt";
import type { InstallRoute } from "@/lib/install";

const BENEFIT = "Opens full screen and works with no signal.";

export function InstallCard() {
  const route = useInstallRoute();
  if (!route) return null;
  const { title, body } = COPY[route];
  return (
    <section aria-labelledby="install-title" className="glass relative mb-4 p-4 pr-12">
      <h2 id="install-title" className="text-[15px] font-semibold">
        {title}
      </h2>
      <div className="mt-1 text-[13.5px] leading-snug text-ink-dim">{body}</div>
      {route === "prompt" && (
        <button
          onClick={() => void promptInstall()}
          className="mt-3 rounded-full bg-accent px-5 py-2 text-[15px] font-semibold text-on-accent"
        >
          Install
        </button>
      )}
      <button
        onClick={dismissInstall}
        aria-label="Not now"
        className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-ink-faint"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M1 1l10 10M11 1L1 11" />
        </svg>
      </button>
    </section>
  );
}

const COPY: Record<InstallRoute, { title: string; body: ReactNode }> = {
  prompt: { title: "Install Rampset", body: BENEFIT },
  ios: {
    title: "Add Rampset to your Home Screen",
    body: (
      // iOS 26's compact tab bar tucks Share under •••.
      <ol className="space-y-1.5">
        <li className="flex gap-2">
          <Step n={1} />
          <span>
            Tap <ShareIcon /> <strong className="font-semibold text-ink">Share</strong> (under ••• on iOS 26)
          </span>
        </li>
        <li className="flex gap-2">
          <Step n={2} />
          <span>
            Choose <AddIcon /> <strong className="font-semibold text-ink">Add to Home Screen</strong>
          </span>
        </li>
      </ol>
    ),
  },
  "mac-safari": {
    title: "Add Rampset to your Dock",
    body: (
      <>
        In Safari&apos;s menu bar, choose <strong className="font-semibold text-ink">File → Add to Dock</strong>.
      </>
    ),
  },
  "android-menu": {
    title: "Install Rampset",
    body: (
      <>
        Open the <strong className="font-semibold text-ink">⋮</strong> menu and choose{" "}
        <strong className="font-semibold text-ink">Add to Home screen</strong>. {BENEFIT}
      </>
    ),
  },
  "in-app-ios": {
    title: "Open in Safari to install",
    body: (
      <>
        This app&apos;s built-in browser can&apos;t add Rampset to your Home Screen. Use its menu to{" "}
        <strong className="font-semibold text-ink">Open in Safari</strong>, then add it from there.
      </>
    ),
  },
  "in-app-android": {
    title: "Open in Chrome to install",
    body: (
      <>
        This app&apos;s built-in browser can&apos;t install Rampset. Use its{" "}
        <strong className="font-semibold text-ink">⋮</strong> menu to{" "}
        <strong className="font-semibold text-ink">Open in Chrome</strong>, then install from there.
      </>
    ),
  },
};

function Step({ n }: { n: number }) {
  return (
    <span aria-hidden className="mono flex h-5 w-5 flex-none items-center justify-center rounded-full bg-fill text-[11px] text-ink">
      {n}
    </span>
  );
}

/** iOS's Share glyph: a box with an arrow out of it. */
function ShareIcon() {
  return (
    <svg width="14" height="17" viewBox="0 0 14 17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="inline align-[-3px] text-accent" aria-hidden>
      <path d="M7 1v10M3.5 4.5L7 1l3.5 3.5M4.5 7H2.5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 2.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 11.5 7h-2" />
    </svg>
  );
}

/** The Share sheet's "Add to Home Screen" glyph: a plus in a rounded box. */
function AddIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="inline align-[-2px] text-ink" aria-hidden>
      <rect x="1" y="1" width="13" height="13" rx="3" />
      <path d="M7.5 4.5v6M4.5 7.5h6" />
    </svg>
  );
}
