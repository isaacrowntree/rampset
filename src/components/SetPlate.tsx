"use client";

/** Program mode's signature control: a set drawn as a weight plate.
 * Tap: empty → full target → decrement → 0 → empty. */

export function SetPlate({
  target,
  value,
  onChange,
  size = 56,
}: {
  target: number;
  /** null = not attempted; otherwise reps done. */
  value: number | null;
  onChange: (next: number | null) => void;
  size?: number;
}) {
  const next = value === null ? target : value === 0 ? null : value - 1;

  const state =
    value === null
      ? "empty"
      : value === target
        ? "done"
        : value === 0
          ? "zero"
          : "partial";

  const border =
    state === "done"
      ? "border-accent"
      : state === "partial"
        ? "border-plate-15"
        : state === "zero"
          ? "border-plate-25"
          : "border-[#2E3036]";
  const bg =
    state === "done"
      ? "bg-accent-soft"
      : state === "partial"
        ? "bg-[rgba(242,194,27,0.10)]"
        : state === "zero"
          ? "bg-[rgba(232,67,63,0.10)]"
          : "bg-black";
  const ink = state === "empty" ? "text-ink-faint" : "text-ink";

  const label =
    value === null
      ? `Set pending, ${target} reps target. Tap to log all reps.`
      : `${value} of ${target} reps logged. Tap to change.`;

  return (
    <button
      aria-label={label}
      onClick={() => onChange(next)}
      style={{ width: size, height: size }}
      className={`disp flex flex-none items-center justify-center rounded-full border-4 text-[17px] transition-transform active:scale-90 ${border} ${bg} ${ink}`}
    >
      {value === null ? (
        <span className="opacity-40">{target}</span>
      ) : (
        value
      )}
    </button>
  );
}
