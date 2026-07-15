"use client";

/** Drives syncNow from the events that actually mean "this view is back in
 * front of the user". Renders nothing. */

import { useEffect } from "react";
import { useUser } from "@/state/UserContext";
import { syncNow } from "@/lib/syncEngine";

/** Safety net only. iOS freezes timers in a backgrounded PWA, so this never
 * fires while you're in the other view — visibilitychange does that work.
 * A tighter interval would just wake the radio for nothing. */
const POLL_MS = 5 * 60_000;

export function SyncEngine() {
  const { user } = useUser();

  useEffect(() => {
    if (!user) return;
    const { id, email } = user;
    const run = () => void syncNow(id, email);

    run(); // Mount is still a real trigger: iOS cold-launches often.

    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    // A Safari tab restored from the bfcache doesn't fire visibilitychange.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) run();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    const poll = setInterval(run, POLL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      clearInterval(poll);
    };
  }, [user]);

  return null;
}
