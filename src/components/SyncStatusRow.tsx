"use client";

/** "Is my data actually leaving this device?"
 *
 * Every sync failure path is a silent catch — offline, a 500, an expired
 * Access session — because none of them should interrupt a workout. The cost
 * was that a week of failed syncs looked exactly like success. This row is the
 * difference. */

import { useEffect, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import {
  subscribeSyncState,
  readSyncState,
  readServerSyncState,
} from "@/lib/syncEngine";

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function summarise(
  state: { lastOkAt?: number; lastError?: string },
  pending: number,
  now: number,
): { label: string; detail: string; tone: "ok" | "warn" | "idle" } {
  const queued =
    pending > 0 ? `${pending} workout${pending === 1 ? "" : "s"} waiting to upload` : null;

  if (state.lastError) {
    return {
      label: "Not syncing",
      detail: state.lastOkAt
        ? `${state.lastError}. Last synced ${ago(state.lastOkAt, now)}.${queued ? ` ${queued}.` : ""}`
        : `${state.lastError}.${queued ? ` ${queued}.` : ""}`,
      tone: "warn",
    };
  }
  if (!state.lastOkAt) {
    return {
      label: "Not synced yet",
      detail: queued ? `${queued}.` : "Nothing has synced on this device yet.",
      tone: "idle",
    };
  }
  return {
    label: `Synced ${ago(state.lastOkAt, now)}`,
    detail: queued ? `${queued}.` : "Everything on this device is uploaded.",
    tone: "ok",
  };
}

export function SyncStatusRow() {
  // Sync state changes from timers and page-lifecycle events, never from
  // rendering — which is exactly what useSyncExternalStore is for.
  const state = useSyncExternalStore(
    subscribeSyncState,
    readSyncState,
    readServerSyncState,
  );
  const pending = useLiveQuery(() => db.outbox.count(), [], 0) ?? 0;

  // "Synced 2 minutes ago" has to keep counting while the page sits open, and
  // reading the clock during render is impure. Tick it instead.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { label, detail, tone } = summarise(state, pending, now);

  return (
    <div className="flex w-full items-center justify-between border-b border-line px-4 py-3.5 text-left">
      <div>
        <div className="text-[15px] font-medium">{label}</div>
        <div className="text-[12.5px] text-ink-faint">{detail}</div>
      </div>
      <span
        aria-hidden
        className={`mono ${tone === "warn" ? "text-plate-25" : tone === "ok" ? "text-plate-10" : "text-ink-faint"}`}
      >
        {tone === "warn" ? "!" : tone === "ok" ? "✓" : "–"}
      </span>
    </div>
  );
}
