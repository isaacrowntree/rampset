"use client";

/** The one orchestrated moment: a workout just finished. Plates drop onto a
 * bar one after another, then the session's tonnage counts up. Under a
 * second and a half, nothing to dismiss, and it never blocks — the workout
 * was saved before this screen existed. Reduced motion lands the end state. */

import { useEffect, useRef } from "react";

/** One of each bumper, heaviest in — the bar loads like a real one. */
const DROP = ["var(--plate-25)", "var(--plate-20)", "var(--plate-15)", "var(--plate-10)", "var(--plate-5)"];

export function Celebration({
  tonnageKg,
  workouts,
  pr,
}: {
  tonnageKg: number;
  workouts: number;
  /** This session set an all-time best. */
  pr: boolean;
}) {
  const target = Math.round(tonnageKg);
  const countRef = useCountUp(target, 900, 420);

  return (
    <section
      role="status"
      aria-label="Workout complete"
      className="glass relative mb-5 overflow-hidden p-5"
      style={{
        backgroundImage:
          "radial-gradient(110% 80% at 50% -20%, color-mix(in srgb, var(--plate-10) 26%, transparent), transparent 70%)",
      }}
    >
      {/* the bar */}
      <div aria-hidden className="relative mx-auto mb-4 flex h-[74px] max-w-[260px] items-center justify-center">
        <span className="absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-gradient-to-b from-[#d1d1d6] via-[#8e8e93] to-[#48484a]" />
        <span className="relative flex items-center gap-[3px]">
          {DROP.map((color, i) => (
            <span
              key={i}
              className="celebrate-drop block rounded-[5px]"
              style={{
                background: `linear-gradient(180deg, rgba(255,255,255,.3), rgba(255,255,255,0) 45%, rgba(0,0,0,.18)), ${color}`,
                width: i < 4 ? 14 : 10,
                height: i < 4 ? 70 : 46,
                animationDelay: `${i * 70}ms`,
              }}
            />
          ))}
        </span>
      </div>

      <h2 className="text-center text-[22px] font-bold leading-7">Workout complete</h2>
      <p className="mt-1 text-center text-[15px] text-ink-dim">
        {workouts === 1
          ? "Your first one. Here’s to many more."
          : `That’s ${workouts.toLocaleString()} workouts so far.`}
      </p>

      <div className="mt-4 flex items-baseline justify-center gap-1.5" aria-hidden>
        <span ref={countRef} className="rounded-num text-[44px] leading-none">
          0
        </span>
        <span className="text-[17px] font-semibold text-ink-dim">kg moved</span>
      </div>
      {/* Screen readers get the final number once, not every frame. */}
      <span className="sr-only">{target.toLocaleString()} kilograms moved this session.</span>

      {pr && (
        <p className="celebrate-pr mx-auto mt-3 flex w-fit items-center gap-1.5 rounded-full bg-plate-15 px-3 py-1 text-[13px] font-semibold text-black">
          <span aria-hidden>★</span> New personal record
        </p>
      )}
    </section>
  );
}

/** rAF count-up with an ease-out, written straight into the node — a
 * setState per frame re-rendered the card ~80 times. Lands instantly under
 * reduced motion. */
function useCountUp(target: number, durationMs: number, delayMs: number) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const show = (n: number) => {
      el.textContent = n.toLocaleString();
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      show(target);
      return;
    }
    let raf = 0;
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        show(Math.round(target * (1 - Math.pow(1 - t, 3))));
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, durationMs, delayMs]);
  return ref;
}
