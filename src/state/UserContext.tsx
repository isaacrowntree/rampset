"use client";

/** Active-user context. Behind Cloudflare Access the authenticated email
 * (via /api/me) picks the user; the switcher and saved selection are the
 * fallback for local dev and offline launches. */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { db } from "@/db/db";
import { seedIfEmpty, reconcileUsers } from "@/db/seed";
import { pickActiveUser } from "@/lib/identity";
import { loadUserConfig, type UserConfig } from "@/config/users";
import type { User } from "@/lib/types";

interface UserContextValue {
  user: User | null;
  users: User[];
  switchUser: (id: string) => void;
  ready: boolean;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  users: [],
  switchUser: () => {},
  ready: false,
});

const ACTIVE_KEY = "liftlog.activeUser";
const CONFIG_CACHE_KEY = "liftlog.userConfig";

export function UserProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Config and identity fetch IN PARALLEL — cold start must not pay
      // sequential network round-trips. Both fail fast offline.
      const [configRes, meRes] = await Promise.allSettled([
        fetch("/api/config", { signal: AbortSignal.timeout(2500) }),
        fetch("/api/me", { signal: AbortSignal.timeout(2000) }),
      ]);

      let config: UserConfig[] | null = null;
      if (configRes.status === "fulfilled" && configRes.value.ok) {
        try {
          const body = (await configRes.value.json()) as { users: UserConfig[] | null };
          if (Array.isArray(body.users) && body.users.length > 0) {
            config = body.users;
            localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(body.users));
          }
        } catch {
          // malformed — fall through to cache
        }
      }
      if (!config) {
        try {
          const cached = localStorage.getItem(CONFIG_CACHE_KEY);
          if (cached) config = JSON.parse(cached) as UserConfig[];
        } catch {
          // corrupted cache — ignore
        }
      }
      const effective = config ?? loadUserConfig();

      await seedIfEmpty(effective);
      await reconcileUsers(effective);
      const all = await db.users.toArray();
      if (cancelled) return;
      setUsers(all);

      let accessEmail: string | null = null;
      if (meRes.status === "fulfilled" && meRes.value.ok) {
        try {
          accessEmail = ((await meRes.value.json()) as { email: string | null }).email;
        } catch {
          // saved selection decides
        }
      }
      if (cancelled) return;

      const savedId = localStorage.getItem(ACTIVE_KEY);
      const active = pickActiveUser(all, accessEmail, savedId);
      if (active) localStorage.setItem(ACTIVE_KEY, active.id);

      // Fresh device? Auto-restore BLOCKS first paint only when the device
      // is empty (there is nothing to show anyway). A device with data
      // renders immediately.
      if (active) {
        const workoutCount = await db.workouts.where({ userId: active.id }).count();
        if (workoutCount === 0) {
          const [{ autoRestoreIfEmpty }, { getLatestCloudBackup }] = await Promise.all([
            import("@/db/autoRestore"),
            import("@/lib/cloudBackup"),
          ]);
          const restored = await autoRestoreIfEmpty(active.id, () =>
            getLatestCloudBackup(active.email),
          );
          if (restored) {
            console.info(
              `Rampset: restored ${restored.workouts} workouts from cloud backup`,
            );
          }
        }
      }
      if (cancelled) return;

      setUser(active);
      setReady(true);
      // Sync is owned by <SyncEngine>, which runs on every foregrounding —
      // not just here. A once-per-mount sync never fires again inside a
      // resumed iOS PWA.
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.body.dataset.accent = user?.accent ?? "blue";
    const theme = user?.theme ?? "dark";
    document.documentElement.dataset.theme = theme;
    // Persist so the inline boot script can apply it before first paint on
    // the next launch (no dark→light flash for the light-skin user).
    try {
      localStorage.setItem("liftlog.theme", theme);
    } catch {
      // private mode — a one-frame flash on next launch is acceptable
    }
  }, [user]);

  const switchUser = (id: string) => {
    const next = users.find((u) => u.id === id);
    if (!next) return;
    localStorage.setItem(ACTIVE_KEY, id);
    setUser(next);
  };

  return (
    <UserContext.Provider value={{ user, users, switchUser, ready }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  return useContext(UserContext);
}
