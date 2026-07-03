"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { UserProvider, useUser } from "@/state/UserContext";
import { BottomNav } from "./BottomNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <UserProvider>
      <Shell>{children}</Shell>
    </UserProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { ready } = useUser();
  const pathname = usePathname();
  const isWorkout = pathname?.startsWith("/workout");

  if (!ready) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center justify-center">
        <PlateSpinner />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <main className={`flex-1 px-4 ${isWorkout ? "pb-6" : "pb-28"} pt-[max(env(safe-area-inset-top),12px)]`}>
        {children}
      </main>
      {!isWorkout && <BottomNav />}
    </div>
  );
}

function PlateSpinner() {
  return (
    <div
      aria-label="Loading"
      className="h-12 w-12 animate-spin rounded-full border-4 border-line border-t-accent"
      style={{ animationDuration: "0.8s" }}
    />
  );
}
