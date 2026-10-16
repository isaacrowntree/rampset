"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Native tab behavior: each tab remembers its scroll position. */
const tabScroll = new Map<string, number>();

const TABS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/program", label: "Program", icon: BarbellIcon },
  { href: "/history", label: "History", icon: CalendarIcon },
  { href: "/progress", label: "Progress", icon: TrendIcon },
  { href: "/settings", label: "Settings", icon: GearIcon },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  // Which tab should play the select-bounce. Only set on tap, so nothing
  // bounces on initial load or browser back/forward.
  const [bounce, setBounce] = useState<string | null>(null);

  const activeIndex = TABS.findIndex(({ href }) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)
  );

  // Restore this tab's saved position after navigation (external system:
  // the window scroller — a legitimate effect). Must be registered before
  // useMinimizeOnScroll so the restore jump isn't read as a user scroll.
  useEffect(() => {
    window.scrollTo({ top: tabScroll.get(pathname) ?? 0 });
  }, [pathname]);

  const minimized = useMinimizeOnScroll(pathname);

  return (
    <nav
      aria-label="Main"
      className={`glass-strong rounded-full fixed inset-x-4 bottom-[max(env(safe-area-inset-bottom),12px)] z-40 mx-auto grid grid-cols-5 px-2 py-1.5 [transition:max-width_360ms_cubic-bezier(0.32,0.72,0.28,1)] ${
        minimized ? "max-w-64" : "max-w-md"
      }`}
    >
      {activeIndex >= 0 && (
        <span
          aria-hidden
          className="dock-lens pointer-events-none absolute bottom-1.5 top-1.5 left-2 w-[calc((100%-1rem)/5)] rounded-full"
          style={{ transform: `translateX(${activeIndex * 100}%)` }}
        />
      )}
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            replace
            scroll={false}
            onClick={() => {
              if (active) {
                // Native retap: the current tab scrolls its content to top.
                tabScroll.set(pathname, 0);
                window.scrollTo({ top: 0, behavior: "smooth" });
                return;
              }
              tabScroll.set(pathname, window.scrollY);
              setBounce(href);
              navigator.vibrate?.(8);
            }}
            aria-current={active ? "page" : undefined}
            className={`relative z-10 flex min-h-[44px] flex-col items-center justify-center rounded-full py-1.5 text-[10px] font-medium transition-colors duration-200 ${
              active ? "text-accent" : "text-ink-faint"
            }`}
          >
            <span
              className={
                bounce === href
                  ? "motion-safe:animate-[tab-bounce_380ms_cubic-bezier(0.34,1.4,0.5,1)]"
                  : undefined
              }
            >
              <Icon filled={active} />
            </span>
            <span
              className={`overflow-hidden transition-[height,opacity,margin-top,scale] duration-300 ${
                minimized ? "mt-0 h-0 scale-75 opacity-0" : "mt-0.5 h-[13px] opacity-100"
              }`}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Native dock behavior: scrolling down collapses the bar to a compact
 * icon-only pill; scrolling up (or reaching the top) expands it again.
 */
function useMinimizeOnScroll(pathname: string) {
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    setMinimized(false); // a fresh tab always starts expanded
    let lastY = window.scrollY;
    let ticking = false;

    const update = () => {
      ticking = false;
      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;
      if (y <= 8) setMinimized(false);
      else if (delta > 4) setMinimized(true);
      else if (delta < -4) setMinimized(false);
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname]);

  return minimized;
}

type IconProps = { filled: boolean };

function HomeIcon({ filled }: IconProps) {
  return filled ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}
function BarbellIcon({ filled }: IconProps) {
  return filled ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <rect x="2.8" y="8" width="2.6" height="8" rx="1.3" />
      <rect x="6.6" y="5.5" width="3" height="13" rx="1.5" />
      <rect x="14.4" y="5.5" width="3" height="13" rx="1.5" />
      <rect x="18.6" y="8" width="2.6" height="8" rx="1.3" />
      <rect x="9.6" y="11" width="4.8" height="2" rx="1" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 9v6M8 6v12M16 6v12M20 9v6M8 12h8" />
    </svg>
  );
}
function CalendarIcon({ filled }: IconProps) {
  return filled ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 10.5h18V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M8 3a1 1 0 0 1 1 1v1h6V4a1 1 0 1 1 2 0v1h2a2 2 0 0 1 2 2v2H3V7a2 2 0 0 1 2-2h2V4a1 1 0 0 1 1-1z" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
function TrendIcon({ filled }: IconProps) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={filled ? 2.6 : 1.7}
      strokeLinecap={filled ? "round" : undefined}
      strokeLinejoin={filled ? "round" : undefined}
    >
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  );
}
function GearIcon({ filled }: IconProps) {
  return filled ? (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd">
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.2-.8.2-1.2zM12 8.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.1-.4.2-.8.2-1.2z" />
    </svg>
  );
}
