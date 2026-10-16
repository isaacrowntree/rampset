"use client";

/** Identity control in the header. A bare initial reads as "my profile", so
 * tapping it opens a menu of the household's users rather than silently
 * swapping identity — one stray tap should never reload the app as someone
 * else. With a single configured user it's an inert badge. */

import { useState } from "react";
import type { User } from "@/lib/types";

const accentColor = (accent: User["accent"]) =>
  accent === "green" ? "var(--plate-10)" : "var(--plate-20)";

export function AvatarSwitcher({
  user,
  users,
  onSwitch,
}: {
  user: User | null;
  users: User[];
  onSwitch: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const canSwitch = users.length > 1;
  const initial = user?.name[0] ?? "?";

  return (
    <div className="relative flex flex-none items-center">
      <button
        onClick={() => canSwitch && setOpen((o) => !o)}
        aria-haspopup={canSwitch ? "menu" : undefined}
        aria-expanded={canSwitch ? open : undefined}
        aria-label={
          canSwitch
            ? `Signed in as ${user?.name ?? "?"}. Switch user`
            : `Signed in as ${user?.name ?? "?"}`
        }
        className="disp flex h-11 w-11 items-center justify-center rounded-full text-[15px] text-white"
        style={{ backgroundColor: user ? accentColor(user.accent) : "var(--accent)" }}
      >
        {initial}
      </button>

      {open && canSwitch && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            aria-label="Switch user"
            className="menu-pop menu-surface absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-[18px] py-1"
          >
            {users.map((u) => {
              const active = u.id === user?.id;
              return (
                <button
                  key={u.id}
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    setOpen(false);
                    if (!active) onSwitch(u.id);
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                >
                  <span
                    aria-hidden
                    className="disp flex h-8 w-8 flex-none items-center justify-center rounded-full text-[13px] text-white"
                    style={{ backgroundColor: accentColor(u.accent) }}
                  >
                    {u.name[0]}
                  </span>
                  <span className="flex-1 truncate text-[14px] text-ink">{u.name}</span>
                  {active && (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="flex-none text-accent"
                      aria-hidden
                    >
                      <path d="M5 12.5 10 17.5 19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
