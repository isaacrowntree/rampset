"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { UserProvider, useUser } from "@/state/UserContext";
import { Onboarding } from "./account/Onboarding";
import { BottomNav } from "./BottomNav";
import { SyncEngine } from "./SyncEngine";
// For its listeners: the install prompt can fire before Home ever mounts.
import "@/lib/installPrompt";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <UserProvider>
      <SyncEngine />
      <Shell>{children}</Shell>
    </UserProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, ready } = useUser();
  const isWorkout = pathname?.startsWith("/workout");

  // A device without an account has nothing to show yet.
  if (ready && !user) return <Onboarding />;

  // The shell renders immediately — pages show their skeletons while the
  // provider boots. No full-screen spinner, no blank frames.
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <main
        key={pathname}
        className={`flex-1 ${
          // Workout: no top padding — its sticky header pads for the safe
          // area itself, so padding here would double-count the notch.
          isWorkout ? "pb-6" : "pb-32 pt-[max(env(safe-area-inset-top),12px)]"
        } pl-[max(env(safe-area-inset-left),16px)] pr-[max(env(safe-area-inset-right),16px)]`}
      >
        {children}
      </main>
      {!isWorkout && <BottomNav />}
    </div>
  );
}
