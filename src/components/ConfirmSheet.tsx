"use client";

/** In-app confirmation — replaces window.confirm's origin-labelled browser
 * dialog with the app's own sheet. */

import { Sheet } from "./Sheet";
import type { RefObject } from "react";

export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  tone = "danger",
  keepHistoryOnUnmount,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** danger = red (destructive); positive = green (finishing well). */
  tone?: "danger" | "positive";
  /** See Sheet: set when confirming navigates instead of just closing. */
  keepHistoryOnUnmount?: RefObject<boolean>;
}) {
  return (
    <Sheet
      label={title}
      onClose={onCancel}
      role="alertdialog"
      keepHistoryOnUnmount={keepHistoryOnUnmount}
    >
      <h2 className="disp text-[18px]">{title}</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-dim">{body}</p>
      <div className="mt-5 flex flex-col gap-2.5">
        <button
          onClick={onConfirm}
          className={`w-full rounded-full py-3.5 text-[15px] font-semibold ${
            tone === "positive" ? "bg-plate-10 text-black" : "bg-plate-25 text-white"
          }`}
        >
          {confirmLabel}
        </button>
        <button
          onClick={onCancel}
          className="glass w-full rounded-full py-3.5 text-[15px] font-medium text-ink"
        >
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
