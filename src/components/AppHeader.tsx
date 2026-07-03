"use client";

import { useUser } from "@/state/UserContext";

export function AppHeader({ title, sub }: { title?: string; sub?: string }) {
  const { user, users, switchUser } = useUser();
  const other = users.find((u) => u.id !== user?.id);

  return (
    <header className="mb-4 flex items-center justify-between pt-2">
      <div>
        {title ? (
          <h1 className="disp text-[21px]">{title}</h1>
        ) : (
          <h1 className="disp text-[21px]">
            LIFTLOG<span className="text-accent">.</span>
          </h1>
        )}
        {sub && <p className="mono mt-0.5 text-xs text-ink-faint">{sub}</p>}
      </div>
      <button
        onClick={() => other && switchUser(other.id)}
        aria-label={`Signed in as ${user?.name}. Switch to ${other?.name ?? "other user"}`}
        className="disp flex h-9 w-9 items-center justify-center rounded-full bg-accent text-[13px] text-white"
      >
        {user?.name[0] ?? "?"}
      </button>
    </header>
  );
}
