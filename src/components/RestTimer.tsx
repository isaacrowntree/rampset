"use client";

/** Auto-starting rest countdown with progress ring, vibration on finish. */

import { useEffect, useRef, useState, useCallback } from "react";

export interface RestTimerHandle {
  start: (seconds: number) => void;
}

const DASH = 113;

export function useRestTimer() {
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(0);
  const [total, setTotal] = useState(90);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (interval.current) clearInterval(interval.current);
    interval.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(
    (seconds: number) => {
      if (seconds <= 0) return;
      stop();
      setTotal(seconds);
      setLeft(seconds);
      setRunning(true);
      interval.current = setInterval(() => {
        setLeft((prev) => {
          if (prev <= 1) {
            stop();
            if (typeof navigator !== "undefined" && "vibrate" in navigator) {
              navigator.vibrate?.([200, 100, 200]);
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    },
    [stop],
  );

  useEffect(() => stop, [stop]);
  return { running, left, total, start, stop };
}

export function RestTimerBar({
  running,
  left,
  total,
  onSkip,
}: {
  running: boolean;
  left: number;
  total: number;
  onSkip: () => void;
}) {
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, "0");
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-4 bottom-6 z-50 mx-auto flex max-w-md items-center gap-3.5 rounded-2xl border border-line bg-surface-2 px-4 py-3 shadow-2xl transition-transform duration-300 ${
        running ? "translate-y-0" : "translate-y-[140%]"
      }`}
    >
      <svg className="h-11 w-11 flex-none -rotate-90" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="18" fill="none" strokeWidth="4" stroke="#2a2c31" />
        <circle
          cx="22"
          cy="22"
          r="18"
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          stroke="var(--plate-10)"
          strokeDasharray={DASH}
          strokeDashoffset={DASH * (1 - (total ? left / total : 0))}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      <div className="flex-1">
        <div className="mono text-[19px] font-semibold">{m}:{s}</div>
        <div className="text-xs text-ink-faint">Rest, then next set</div>
      </div>
      <button onClick={onSkip} className="px-2 py-2 text-[13px] font-medium text-ink-dim">
        Skip
      </button>
    </div>
  );
}
