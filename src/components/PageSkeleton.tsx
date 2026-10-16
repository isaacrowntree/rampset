"use client";

/** Stable chrome shown while Dexie loads — a tab switch shows the page's
 * skeleton instantly instead of a blank black frame. */

import { AppHeader } from "./AppHeader";

export function PageSkeleton({ title }: { title?: string }) {
  return (
    <div aria-hidden className="motion-safe:animate-pulse">
      <AppHeader title={title} />
      {/* Same rhythm as the real pages — a header gap above each grouped
          cell — so content lands without a jump. */}
      <div className="mb-2 mt-6 h-[18px]" />
      <div className="glass h-[420px]" />
      <div className="mb-2 mt-7 h-[18px]" />
      <div className="glass h-[120px]" />
    </div>
  );
}
