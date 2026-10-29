"use client";

/** This device's account. One account per device: it's whoever signed in here.
 *
 * Boot never waits on the network when the device already has an account —
 * the gym has no signal, and the data is local. The session check runs
 * behind it and only decides whether writes may leave the device. A device
 * with no account shows onboarding instead of the app. */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { db } from "@/db/db";
import { adoptAccount, localUser, userFromAccount, wipeDevice, type Account } from "@/db/account";
import { currentAccount, updateProfile } from "@/lib/auth";
import { setSessionAccount } from "@/lib/identityGate";
import type { User } from "@/lib/types";

/** signed-in: the server confirmed this device's account. signed-out: it
 * didn't — sync and backup are paused until the lifter signs in again.
 * unknown: we haven't been able to ask (offline). */
export type SessionState = "signed-in" | "signed-out" | "unknown";

interface UserContextValue {
  user: User | null;
  ready: boolean;
  session: SessionState;
  /** Make `account` this device's: after creating it, signing in, or recovering. */
  adopt: (account: Account) => Promise<void>;
  /** The server returned a newer copy of the account (name, email, theme). */
  refresh: (account: Account) => Promise<void>;
  /** Change this device's copy now — offline included; the account follows. */
  patchUser: (patch: Partial<Pick<User, "theme">>) => Promise<void>;
  /** Forget this device's account and data, and start over. */
  leave: () => Promise<void>;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  ready: false,
  session: "unknown",
  adopt: async () => {},
  refresh: async () => {},
  patchUser: async () => {},
  leave: async () => {},
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SessionState>("unknown");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = await localUser();
      if (cancelled) return;
      const checking = currentAccount();

      if (local) {
        // The data is local: never wait on the network to show it.
        setUser(local);
        setReady(true);
        let account = await checking;
        if (cancelled) return;
        if (account === undefined) return; // offline: carry on as we were
        if (account?.id === local.id) {
          setSessionAccount(account.id);
          setSession("signed-in");
          // A change made here while offline goes up before anything comes
          // down — the server's copy is the older one.
          const pending = pendingProfile();
          if (pending) {
            account = await updateProfile({ profile: pending }).catch(() => account!);
            if (account.profile.theme === pending.theme) clearPendingProfile();
          }
          // Name, recovery email and theme may have changed on another device.
          const fresh = { ...userFromAccount(account), ...(pendingProfile() ?? {}) };
          await db.users.put(fresh);
          if (!cancelled) setUser(fresh);
        } else {
          // Signed out — or, rarely, signed in as someone else in another
          // tab. Either way this device's data must not go out under it.
          setSessionAccount(null);
          setSession("signed-out");
        }
        return;
      }

      // No account on this device. A live session (data cleared, or a second
      // tab finished onboarding) adopts straight in; otherwise onboarding.
      // Wait briefly for the answer: onboarding shown while a session is
      // still being adopted would let someone start a second account on top
      // of it. A slow answer forfeits — onboarding, and the session is
      // ignored (signing in picks it up again).
      const account = await Promise.race([checking, timeout(SESSION_WAIT_MS)]);
      if (cancelled) return;
      if (account) {
        const adopted = await adoptAndRestore(account);
        if (cancelled) return;
        setSessionAccount(account.id);
        setSession("signed-in");
        setUser(adopted);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.body.dataset.accent = user?.accent ?? "blue";
    const theme = user?.theme ?? "dark";
    document.documentElement.dataset.theme = theme;
    // The browser/OS chrome color follows the skin, not just the page.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "light" ? "#f2f2f7" : "#000000");
    // Persist so the inline boot script can apply it before first paint on
    // the next launch (no dark→light flash for the light-skin user).
    try {
      localStorage.setItem("liftlog.theme", theme);
    } catch {
      // private mode — a one-frame flash on next launch is acceptable
    }
  }, [user]);

  const adopt = async (account: Account) => {
    // One account per device: signing in as someone else replaces this one.
    // The session cookie is already theirs, so a fresh boot adopts them.
    if (user && user.id !== account.id) {
      await wipeDevice();
      window.location.replace("/");
      return;
    }
    const adopted = await adoptAndRestore(account);
    setSessionAccount(account.id);
    setSession("signed-in");
    setUser(adopted);
    setReady(true);
  };

  const refresh = async (account: Account) => {
    const next = userFromAccount(account);
    await db.users.put(next);
    setUser(next);
  };

  /** Here first, then the account — now if online, else on the next online
   * launch (see boot), so an offline change isn't undone by the server's
   * older copy. */
  const patchUser = async (patch: Partial<Pick<User, "theme">>) => {
    if (!user) return;
    const next = { ...user, ...patch };
    await db.users.put(next);
    setUser(next);
    if (user.id.startsWith("local_")) return;
    savePendingProfile(patch);
    const account = await updateProfile({ profile: patch }).catch(() => null);
    if (account) clearPendingProfile();
  };

  const leave = async () => {
    setSessionAccount(null);
    await wipeDevice();
    // A clean start: every module-level cache (sync engines, live queries)
    // still points at the deleted database.
    window.location.replace("/");
  };

  return (
    <UserContext.Provider value={{ user, ready, session, adopt, refresh, patchUser, leave }}>
      {children}
    </UserContext.Provider>
  );
}

const SESSION_WAIT_MS = 2500;
const PENDING_KEY = "liftlog.pendingProfile";

function timeout(ms: number): Promise<undefined> {
  return new Promise((r) => setTimeout(() => r(undefined), ms));
}

function pendingProfile(): Partial<Pick<User, "theme">> | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Partial<Pick<User, "theme">>) : null;
  } catch {
    return null;
  }
}

function savePendingProfile(patch: Partial<Pick<User, "theme">>): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ ...pendingProfile(), ...patch }));
  } catch {
    // private mode — it syncs now or not at all
  }
}

function clearPendingProfile(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // nothing to clear
  }
}

/** Set up the device for `account`, then — when it has no workouts yet, i.e.
 * a new phone — fill it from the cloud snapshot. Sync brings anything newer. */
async function adoptAndRestore(account: Account): Promise<User> {
  const adopted = await adoptAccount(account);
  const [{ autoRestoreIfEmpty }, { getLatestCloudBackup }] = await Promise.all([
    import("@/db/autoRestore"),
    import("@/lib/cloudBackup"),
  ]);
  const restored = await autoRestoreIfEmpty(adopted.id, () => getLatestCloudBackup(adopted.id));
  if (restored) console.info(`Rampset: restored ${restored.workouts} workouts from cloud backup`);
  return adopted;
}

export function useUser(): UserContextValue {
  return useContext(UserContext);
}
