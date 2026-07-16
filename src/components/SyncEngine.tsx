"use client";

/** Starts the sync engine for the active user. Renders nothing.
 *
 * The engine (durable-sync) owns the triggers — visibilitychange, pageshow,
 * focus, online, and a visible-only poll — because one sync per mount is never
 * enough: an iOS home-screen PWA is frozen and restored rather than remounted,
 * so its mount effect can go days without running again. */

import { useEffect } from "react";
import { useUser } from "@/state/UserContext";
import { syncFor } from "@/lib/syncFor";

export function SyncEngine() {
  const { user } = useUser();

  useEffect(() => {
    if (!user) return;
    // syncFor memoizes per user, so this is the same engine across remounts —
    // which is what keeps the throttle meaningful.
    return syncFor(user).start();
  }, [user]);

  return null;
}
