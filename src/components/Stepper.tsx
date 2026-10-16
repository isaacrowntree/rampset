"use client";

/** A −/value/+ stepper row used by the mid-workout exercise sheet and the
 * program editor. The value is right-aligned tabular so digits and the sign
 * never jump; the node remounts (key) on its own GPU layer so iOS Safari
 * can't leave the previous value ghosted over the glass backdrop-filter. */
export function Stepper({
  label,
  value,
  display,
  onStep,
}: {
  label: string;
  value: number;
  display: string;
  onStep: (dir: -1 | 1) => void;
}) {
  return (
    <div className="flex min-h-[48px] items-center justify-between border-b border-line py-1.5 last:border-b-0">
      <span className="text-[17px]">{label}</span>
      <span className="flex items-center gap-2.5">
        <button
          aria-label={`Decrease ${label.toLowerCase()} (now ${value})`}
          onClick={() => onStep(-1)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-fill text-[22px] font-light text-ink"
        >
          −
        </button>
        <span
          key={display}
          style={{ transform: "translateZ(0)" }}
          className="mono min-w-[72px] text-right text-[17px] font-semibold tabular-nums text-ink"
        >
          {display}
        </span>
        <button
          aria-label={`Increase ${label.toLowerCase()} (now ${value})`}
          onClick={() => onStep(1)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-fill text-[22px] font-light text-ink"
        >
          +
        </button>
      </span>
    </div>
  );
}
