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
      <h2 className="text-center text-[20px] font-semibold">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-[30ch] text-center text-[15px] leading-snug text-ink-dim">
        {body}
      </p>
      <div className="mt-6 flex flex-col gap-1">
        <button
          onClick={onConfirm}
          className={`w-full rounded-full py-3.5 text-[17px] font-semibold ${
            tone === "positive" ? "bg-plate-10 text-black" : "bg-plate-25 text-black"
          }`}
        >
          {confirmLabel}
        </button>
        <button onClick={onCancel} className="w-full py-3.5 text-[17px] text-accent">
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
