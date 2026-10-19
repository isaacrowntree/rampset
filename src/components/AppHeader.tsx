"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useUser } from "@/state/UserContext";

export function AppHeader({ title, sub }: { title?: string; sub?: string }) {
  const { user } = useUser();
  const pathname = usePathname();
  const titleRef = useRef<HTMLHeadingElement>(null);
  // UIKit's collapsing large title: once it scrolls under the status bar, a
  // compact title fades in on a blurred bar. An observer, not a scroll
  // handler — nothing runs per frame.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // Collapse where the inline bar's bottom edge is: 44pt below the safe
    // area, which on a notched iPhone is ~59pt down — not 44 from the top.
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden";
    document.body.appendChild(probe);
    const inset = probe.offsetHeight;
    probe.remove();
    const io = new IntersectionObserver(([e]) => setCollapsed(!e.isIntersecting), {
      rootMargin: `-${inset + 44}px 0px 0px 0px`,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const name = title ?? "Rampset";

  return (
    <>
      <div
        aria-hidden
        className={`nav-inline pointer-events-none fixed inset-x-0 top-0 z-30 mx-auto max-w-md pt-[env(safe-area-inset-top)] ${
          collapsed ? "opacity-100" : "-translate-y-1 opacity-0"
        }`}
      >
        <div className="flex h-11 items-center justify-center text-[17px] font-semibold">{name}</div>
      </div>
      {/* UIKit large title: 34pt bold on the tab root, trailing avatar. */}
      <header className="mb-3 flex items-center justify-between gap-3 pt-3">
        <div className="min-w-0">
          {title ? (
            <h1 ref={titleRef} className="large-title truncate">
              {title}
            </h1>
          ) : (
            <h1 ref={titleRef} className="large-title">
              Rampset<span className="text-accent">.</span>
            </h1>
          )}
          {sub && <p className="mt-1.5 text-[15px] text-ink-faint">{sub}</p>}
        </div>
        {/* The device's one account; its controls live in Settings. */}
        <Link
          href="/settings"
          aria-current={pathname === "/settings" ? "page" : undefined}
          aria-label={`${user?.name ?? "Account"} — settings`}
          className="disp flex h-11 w-11 flex-none items-center justify-center rounded-full text-[15px] text-white"
          style={{ backgroundColor: user?.accent === "green" ? "var(--plate-10)" : "var(--plate-20)" }}
        >
          {user?.name[0]?.toUpperCase() ?? ""}
        </Link>
      </header>
    </>
  );
}
