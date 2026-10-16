"use client";

/** Pull a full-screen view down to dismiss it, the way Now Playing and iOS
 * page sheets go away: from the top of the scroll, the whole screen follows
 * the finger (shrinking a touch, corners rounding), then either leaves or
 * springs back. Transforms are written straight to the element — nothing
 * re-renders per frame. */

import { useEffect, useRef, type RefObject } from "react";

export function usePullToDismiss(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  enabled = true,
) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let g: { y0: number; x0: number; dy: number; lastY: number; lastT: number; v: number; locked: boolean | null } | null =
      null;

    const set = (dy: number, transition: string) => {
      el.style.transition = transition;
      if (dy <= 0) {
        el.style.transform = "";
        el.style.borderRadius = "";
        el.style.overflow = "";
        return;
      }
      const h = window.innerHeight || 800;
      const scale = 1 - Math.min(dy / h, 1) * 0.08;
      el.style.transform = `translateY(${dy}px) scale(${scale})`;
      el.style.transformOrigin = "50% 0";
      el.style.borderRadius = "28px";
      el.style.overflow = "hidden";
    };

    const onStart = (e: TouchEvent) => {
      g = null;
      // Only from the top of the page, and never from inside an overlay
      // (sheets, menus, alerts own their own gestures).
      if (window.scrollY > 0) return;
      // A sheet is open (it locks body scroll): its backdrop isn't ours to drag.
      if (document.body.style.overflow === "hidden") return;
      const target = e.target as Element | null;
      if (target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      const t = e.touches[0];
      g = { y0: t.clientY, x0: t.clientX, dy: 0, lastY: t.clientY, lastT: e.timeStamp, v: 0, locked: null };
    };

    const onMove = (e: TouchEvent) => {
      if (!g) return;
      const t = e.touches[0];
      const dy = t.clientY - g.y0;
      const dx = t.clientX - g.x0;
      // Decide once: only a downward, mostly-vertical start is a pull.
      if (g.locked === null && Math.abs(dx) + Math.abs(dy) > 8) {
        g.locked = dy > 0 && Math.abs(dy) > Math.abs(dx);
        if (!g.locked) {
          g = null;
          return;
        }
      }
      if (!g.locked) return;
      e.preventDefault(); // the screen moves, not iOS's rubber band
      g.v = (t.clientY - g.lastY) / Math.max(1, e.timeStamp - g.lastT);
      g.lastY = t.clientY;
      g.lastT = e.timeStamp;
      g.dy = Math.max(0, dy);
      set(g.dy, "none");
    };

    const onEnd = (e: TouchEvent) => {
      const s = g;
      g = null;
      if (!s?.locked) return;
      const v = e.timeStamp - s.lastT > 80 ? 0 : s.v;
      const h = window.innerHeight || 800;
      if (s.dy > h * 0.22 || (v > 0.6 && s.dy > 24)) {
        set(h, "transform 260ms cubic-bezier(0.32, 0, 0.67, 0)");
        window.setTimeout(() => dismissRef.current(), 220);
      } else {
        set(0, "transform 630ms var(--spring-sheet), border-radius 630ms ease");
      }
    };

    const onCancel = () => {
      if (g?.locked) set(0, "transform 470ms var(--spring-snappy)");
      g = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
      el.style.transform = "";
      el.style.borderRadius = "";
      el.style.overflow = "";
    };
  }, [ref, enabled]);
}
