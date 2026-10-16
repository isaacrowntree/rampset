"use client";

/** Program mode's signature control: a set drawn as a weight plate.
 * Tap: empty → full target → decrement → 0 → empty.
 *
 * A finished set fills in the color of the heaviest plate on the bar, so a
 * session reads like the loaded bar does from across the gym. Outcome is
 * carried by SHAPE, not hue (plate red/yellow already mean 25/15kg):
 *   empty   — quiet ring, target shown dimly
 *   done    — solid plate, rim and sheen
 *   partial — ring in the plate color, reps inside
 *   zero    — dashed ring */

import { useState, type CSSProperties } from "react";

export interface PlateTone {
  fill: string;
  ink: string;
}

export function SetPlate({
  target,
  value,
  onChange,
  size,
  bonus = false,
  tone,
  upNext = false,
}: {
  target: number;
  /** null = not attempted; otherwise reps done. */
  value: number | null;
  onChange: (next: number | null) => void;
  /** Fixed px size; omit to fill the parent's grid cell. */
  size?: number;
  /** An extra set added beyond the prescription — marked so it doesn't read
   * as a missing prescribed set. */
  bonus?: boolean;
  /** The load's plate color; omit (bodyweight, light loads) for the accent. */
  tone?: PlateTone | null;
  /** The set to do next — gets a ring, so a glance from the bench finds it. */
  upNext?: boolean;
}) {
  const next = value === null ? target : value === 0 ? null : value - 1;
  // Only a plate tapped in this mount animates — returning to the workout
  // tab mustn't replay a pop on every set already done.
  const [tapped, setTapped] = useState(false);

  const state =
    value === null
      ? "empty"
      : value >= target
        ? "done"
        : value === 0
          ? "zero"
          : "partial";

  const label =
    value === null
      ? `${bonus ? "Bonus set" : "Set"} pending, ${target} reps target. Tap to log all reps.`
      : `${value} of ${target} reps logged. Tap to change.`;

  const style = {
    "--plate-fill": tone?.fill ?? "var(--accent)",
    "--plate-ink": tone?.ink ?? "var(--on-accent)",
    ...(size !== undefined ? { width: size, height: size } : {}),
  } as CSSProperties;

  return (
    <button
      aria-label={label}
      data-state={state}
      data-bonus={bonus || undefined}
      data-anim={tapped || undefined}
      data-next={(upNext && value === null) || undefined}
      onClick={() => {
        setTapped(true);
        // Native-feel haptic tick on the core interaction.
        if (typeof navigator !== "undefined") navigator.vibrate?.(10);
        onChange(next);
      }}
      style={style}
      className={`set-plate disp flex flex-none items-baseline justify-center rounded-full pt-[0.1em] text-[19px] ${
        size === undefined ? "aspect-square w-full" : ""
      }`}
    >
      {/* Line-height trick: baseline-align the reps with a small "/5" so a
          short set says so in words, not only by its ring. */}
      <span className="self-center">
        {value === null ? target : value}
        {state === "partial" && (
          <span aria-hidden className="text-[11px] font-semibold opacity-70">
            /{target}
          </span>
        )}
      </span>
    </button>
  );
}
