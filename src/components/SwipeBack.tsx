"use client";

/** Interactive swipe-back for a pushed page. A standalone iOS PWA gets no
 * browser back gesture, so a drill-in would otherwise be a dead end without
 * reaching for the top-left chevron.
 *
 * Starts only from the left edge, follows the finger, and on release either
 * finishes the pop (past a third of the width, or flicked) or springs back.
 * Writes transforms straight to the DOM: nothing re-renders per frame. */

import { useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

const EDGE = 28;

export function SwipeBack({ fallbackHref, children }: { fallbackHref: string; children: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const g = useRef<{ x0: number; y0: number; dx: number; lastX: number; lastT: number; v: number; locked: boolean | null } | null>(null);

  const back = () => {
    // Deep-linked with nothing behind it: go to the parent instead of out.
    if (window.history.length > 1) router.back();
    else router.replace(fallbackHref);
  };

  const set = (x: number, transition: string) => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = transition;
    el.style.transform = x === 0 ? "" : `translateX(${x}px)`;
    el.style.boxShadow = x === 0 ? "" : "-12px 0 32px rgba(0,0,0,0.5)";
  };

  return (
    <div
      ref={ref}
      className="min-h-dvh bg-oled"
      onTouchStart={(e) => {
        // Every touch starts clean — a gesture iOS took over (touchcancel)
        // must not leave a half-swipe armed for the next one.
        g.current = null;
        const t = e.touches[0];
        if (t.clientX > EDGE) return;
        g.current = { x0: t.clientX, y0: t.clientY, dx: 0, lastX: t.clientX, lastT: e.timeStamp, v: 0, locked: null };
      }}
      onTouchMove={(e) => {
        const s = g.current;
        if (!s) return;
        const t = e.touches[0];
        const dx = t.clientX - s.x0;
        const dy = t.clientY - s.y0;
        // Decide once: a vertical start is a scroll, not a swipe.
        if (s.locked === null && Math.abs(dx) + Math.abs(dy) > 8) {
          s.locked = Math.abs(dx) > Math.abs(dy);
          if (!s.locked) {
            g.current = null;
            return;
          }
        }
        if (!s.locked) return;
        s.v = (t.clientX - s.lastX) / Math.max(1, e.timeStamp - s.lastT);
        s.lastX = t.clientX;
        s.lastT = e.timeStamp;
        s.dx = Math.max(0, dx);
        set(s.dx, "none");
      }}
      onTouchCancel={() => {
        if (g.current?.locked) set(0, "transform 470ms var(--spring-snappy)");
        g.current = null;
      }}
      onTouchEnd={() => {
        const s = g.current;
        g.current = null;
        if (!s?.locked) return;
        const w = ref.current?.offsetWidth ?? window.innerWidth;
        if (s.dx > w / 3 || (s.v > 0.5 && s.dx > 20)) {
          set(w, "transform 220ms cubic-bezier(0.32, 0, 0.67, 0)");
          window.setTimeout(back, 200);
        } else {
          set(0, "transform 470ms var(--spring-snappy)");
        }
      }}
    >
      {children}
    </div>
  );
}
