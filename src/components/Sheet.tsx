"use client";

/** Native-feeling bottom sheet: slide-up entrance, drag handle,
 * swipe-to-dismiss, Escape, scroll lock, focus — and a history entry so the
 * Android back gesture closes the sheet instead of the screen. */

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

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
  const dragStart = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    panelRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Back gesture closes the sheet, not the app.
    window.history.pushState({ liftlogSheet: true }, "");
    const onPop = () => {
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (!closedByPop.current && !keepHistoryOnUnmount?.current) {
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60] mx-auto flex max-w-md flex-col justify-end bg-black/70 motion-safe:animate-[sheet-backdrop_200ms_ease]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="glass-strong max-h-[85dvh] overflow-y-auto overscroll-contain rounded-b-none rounded-t-[28px] outline-none motion-safe:animate-[sheet-up_260ms_cubic-bezier(0.32,0.72,0.28,1)]"
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          // Only start a dismiss-drag from the top of the sheet's scroll.
          if ((e.currentTarget.scrollTop ?? 0) <= 0) {
            dragStart.current = e.touches[0].clientY;
          }
        }}
        onTouchMove={(e) => {
          if (dragStart.current === null) return;
          const dy = e.touches[0].clientY - dragStart.current;
          if (dy > 0) setDragY(dy);
        }}
        onTouchEnd={() => {
          const shouldClose = dragY > 90;
          dragStart.current = null;
          setDragY(0);
          if (shouldClose) onClose();
        }}
      >
        <div aria-hidden className="sticky top-0 flex justify-center pb-1 pt-2.5">
          <span className="h-1 w-9 rounded-full bg-white/25" />
        </div>
        <div className="p-5 pb-[max(env(safe-area-inset-bottom),32px)] pt-1">{children}</div>
      </div>
    </div>
  );
}
