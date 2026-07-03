"use client";

/** Active-user context. Locally this is a switcher; behind Cloudflare Access
 * the deployment resolves the user from the authenticated email instead. */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { db } from "@/db/db";
import { seedIfEmpty } from "@/db/seed";
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

export function UserProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await seedIfEmpty();
      const all = await db.users.toArray();
      if (cancelled) return;
      setUsers(all);
      const savedId = localStorage.getItem(ACTIVE_KEY);
      setUser(all.find((u) => u.id === savedId) ?? all[0] ?? null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.body.dataset.accent = user?.accent ?? "blue";
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
