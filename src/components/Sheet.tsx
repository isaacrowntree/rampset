"use client";

/** Native-feeling bottom sheet: slide-up entrance, drag handle,
 * swipe-to-dismiss, Escape, scroll lock, focus — and a history entry so the
 * Android back gesture closes the sheet instead of the screen. */

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";

/** The entry-pop a closing sheet has scheduled but not yet run. Module-level,
 * not per instance: the sheet that cancels it is often a different one. */
let pendingBack: number | null = null;

export function Sheet({
  label,
  onClose,
  children,
  role = "dialog",
  keepHistoryOnUnmount,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  role?: "dialog" | "alertdialog";
  /** Set this true before navigating the router. `router.replace` overwrites
   * the top history entry — ours — so consuming it again on unmount would
   * walk the user back to the screen they just left. A ref rather than a
   * plain prop because the unmount cleanup has to read it at teardown. */
  keepHistoryOnUnmount?: RefObject<boolean>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closedByPop = useRef(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  // Drag-to-dismiss tracks the finger in a ref and writes transforms straight
  // to the DOM: a setState per touchmove re-rendered the sheet and everything
  // in it, every frame.
  const drag = useRef<{
    y0: number;
    dy: number;
    lastY: number;
    lastT: number;
    v: number;
    h: number;
  } | null>(null);
  const dismissing = useRef(false);
  // Tags the history entry this sheet pushes, so it can tell a pop that
  // leaves its entry from one that lands back ON it.
  const entryId = useId();

  useEffect(() => {
    panelRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Back gesture closes the sheet, not the app. A sheet mounting while a
    // teardown's pop is still pending — StrictMode's remount, or one sheet
    // replacing another in the same commit (summary → edit) — cancels that
    // pop and takes the entry over, rather than push a second one that the
    // pending pop would then take away from it.
    if (pendingBack !== null) {
      window.clearTimeout(pendingBack);
      pendingBack = null;
      window.history.replaceState({ liftlogSheet: entryId }, "");
    } else {
      window.history.pushState({ liftlogSheet: entryId }, "");
    }
    const onPop = () => {
      // A pop that lands on our own entry closed a sheet stacked above this
      // one — only that one should close.
      if (window.history.state?.liftlogSheet === entryId) return;
      closedByPop.current = true;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap: Tab must not escape the modal to the page behind it.
      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) {
          e.preventDefault();
          panel.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        const inside = panel.contains(active);
        if (e.shiftKey && (active === first || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("popstate", onPop);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("keydown", onKey);
      // Closed by button/backdrop/swipe: consume the entry we pushed.
      // Navigating away instead: the router already overwrote it.
      //
      // Reading .current at teardown is the entire point — the caller sets it
      // between mount and unmount — so the usual "copy it into the effect"
      // advice would reinstate the bug.
      //
      // Deferred a tick so a remount can cancel it: Chrome resolves back()'s
      // target when it's called, so popping now and pushing again on remount
      // lands BELOW both entries — and closed every sheet on open in dev.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (!closedByPop.current && !keepHistoryOnUnmount?.current) {
        pendingBack = window.setTimeout(() => {
          pendingBack = null;
          window.history.back();
        }, 0);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React's touch handlers are passive, so they can't stop iOS scrolling (and
  // bouncing) the content while the finger is dragging the sheet down.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onMove = (e: TouchEvent) => {
      if (drag.current && drag.current.dy > 0) e.preventDefault();
    };
    panel.addEventListener("touchmove", onMove, { passive: false });
    return () => panel.removeEventListener("touchmove", onMove);
  }, []);

  const setOffset = (dy: number, transition: string) => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.transition = transition;
    panel.style.transform = dy === 0 ? "" : `translateY(${dy}px)`;
    const h = drag.current?.h ?? (panel.offsetHeight || 1);
    if (backdropRef.current) {
      backdropRef.current.style.transition = transition.replace("transform", "opacity");
      backdropRef.current.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / h));
    }
  };

  const onTouchEnd = (e: { timeStamp: number }) => {
    const d = drag.current;
    drag.current = null;
    const panel = panelRef.current;
    if (!d || !panel) return;
    // A drag that paused before release isn't a flick, however fast it was.
    const v = e.timeStamp - d.lastT > 80 ? 0 : d.v;
    // UIKit's rule of thumb: past a third of the height, or flicked down.
    if (d.dy > d.h / 3 || (v > 0.5 && d.dy > 12)) {
      dismissing.current = true;
      // Invisible from here on — it must not swallow taps while it goes.
      if (backdropRef.current) backdropRef.current.style.pointerEvents = "none";
      setOffset(d.h, "transform 260ms cubic-bezier(0.32, 0, 0.67, 0)");
      window.setTimeout(onClose, 240);
    } else {
      // Springs home from wherever the finger let go.
      setOffset(0, "transform 630ms var(--spring-sheet)");
    }
  };

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[60] mx-auto flex max-w-md flex-col justify-end bg-black/60 motion-safe:animate-[sheet-backdrop_240ms_ease]"
      onClick={() => {
        if (!dismissing.current) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="sheet-surface max-h-[88dvh] overflow-y-auto overscroll-contain rounded-t-[32px] outline-none motion-safe:animate-[sheet-up_630ms_var(--spring-sheet)]"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          // Only start a dismiss-drag from the top of the sheet's scroll.
          if ((e.currentTarget.scrollTop ?? 0) <= 0) {
            // The entrance animation owns `transform` until it ends; finish
            // it so a quick swipe isn't ignored for its first 630ms.
            e.currentTarget.getAnimations?.().forEach((a) => a.finish());
            backdropRef.current?.getAnimations?.().forEach((a) => a.finish());
            const y = e.touches[0].clientY;
            drag.current = {
              y0: y,
              dy: 0,
              lastY: y,
              lastT: e.timeStamp,
              v: 0,
              h: e.currentTarget.offsetHeight || 1,
            };
          }
        }}
        onTouchMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const y = e.touches[0].clientY;
          const dt = Math.max(1, e.timeStamp - d.lastT);
          d.v = (y - d.lastY) / dt;
          d.lastY = y;
          d.lastT = e.timeStamp;
          d.dy = y - d.y0;
          // Pulling up on content that scrolls is a scroll, not a drag.
          const el = e.currentTarget;
          if (d.dy < 0 && el.scrollHeight > el.clientHeight) {
            drag.current = null;
            setOffset(0, "none");
            return;
          }
          // Above the resting point the sheet rubber-bands instead of following.
          const shown = d.dy >= 0 ? d.dy : -((-d.dy * 0.55) / (1 + -d.dy / d.h));
          setOffset(shown, "none");
        }}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div aria-hidden className="sticky top-0 z-10 flex justify-center pb-1 pt-2.5">
          <span className="h-[5px] w-9 rounded-full bg-ink-faint/50" />
        </div>
        <div className="p-5 pb-[max(env(safe-area-inset-bottom),32px)] pt-1">{children}</div>
      </div>
    </div>
  );
}
