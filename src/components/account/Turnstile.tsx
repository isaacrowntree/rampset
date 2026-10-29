"use client";

/** Cloudflare Turnstile, only when the server is configured for it. Managed
 * mode: most people never see a challenge, just a brief check. */

import { useEffect, useRef, useState } from "react";

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<void> | null = null;

function load(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** `onToken` should be stable (a state setter): the widget re-renders when it
 * changes. `action` names the form, and the server checks it, so a token
 * solved for sign-up can't be spent on recovery. */
export function Turnstile({
  siteKey,
  action,
  onToken,
}: {
  siteKey: string;
  action: "signup" | "recover";
  onToken: (token: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // A blocker, a captive portal or lie-fi can stop the script. Say so, or the
  // button it gates just sits there disabled.
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    load().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      id = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        action,
        theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    }, () => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (id) window.turnstile?.remove(id);
    };
  }, [siteKey, action, onToken, tries]);

  if (failed) {
    return (
      <p role="alert" className="mb-3 flex items-center justify-between gap-3 px-1 text-[15px] leading-snug text-danger">
        Couldn&apos;t load the security check. Check your connection.
        <button
          type="button"
          className="min-h-[44px] flex-none px-2 text-accent"
          onClick={() => {
            setFailed(false);
            setTries((n) => n + 1);
          }}
        >
          Retry
        </button>
      </p>
    );
  }
  return <div ref={ref} className="flex min-h-[65px] justify-center" />;
}
