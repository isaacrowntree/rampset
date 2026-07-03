"use client";

/** Routine mode's logging row — the Strong layout: SET · PREVIOUS · KG · REPS · ✓
 * (or SET · PREVIOUS · SECONDS · ✓ for timed sets). */

export interface SetRowChange {
  weightKg?: number;
  reps?: number;
  seconds?: number;
}

export function SetRow({
  index,
  previous,
  weightKg,
  reps,
  seconds,
  timed = false,
  bodyweight = false,
  done,
  onChange,
  onToggle,
}: {
  index: number;
  previous: string;
  weightKg?: number;
  reps?: number;
  seconds?: number;
  timed?: boolean;
  bodyweight?: boolean;
  done: boolean;
  onChange: (values: SetRowChange) => void;
  onToggle: () => void;
}) {
  const emit = (patch: Partial<SetRowChange>) => {
    const base: SetRowChange = timed
      ? { seconds }
      : bodyweight
        ? { reps }
        : { weightKg, reps };
    onChange({ ...base, ...patch });
  };

  const num = (v: string) => (v === "" ? undefined : Number(v));

  return (
    <div
      className={`grid items-center gap-2 py-1.5 ${
        timed
          ? "grid-cols-[28px_1fr_76px_44px]"
          : bodyweight
            ? "grid-cols-[28px_1fr_76px_44px]"
            : "grid-cols-[28px_1fr_76px_64px_44px]"
      } ${done ? "opacity-90" : ""}`}
    >
      <span
        className={`disp flex h-7 w-7 items-center justify-center rounded-full text-[13px] ${
          done ? "bg-accent-soft text-ink" : "bg-surface-2 text-ink-dim"
        }`}
      >
        {index + 1}
      </span>

      <span className="mono truncate text-[12.5px] text-ink-faint">{previous}</span>

      {timed ? (
        <input
          className="setfield"
          type="number"
          inputMode="numeric"
          aria-label={`Set ${index + 1} seconds`}
          value={seconds ?? ""}
          placeholder="sec"
          onChange={(e) => emit({ seconds: num(e.target.value) })}
        />
      ) : (
        <>
          {!bodyweight && (
            <input
              className="setfield"
              type="number"
              inputMode="decimal"
              step="0.5"
              aria-label={`Set ${index + 1} weight in kg`}
              value={weightKg ?? ""}
              placeholder="kg"
              onChange={(e) => emit({ weightKg: num(e.target.value) })}
            />
          )}
          <input
            className="setfield"
            type="number"
            inputMode="numeric"
            aria-label={`Set ${index + 1} reps`}
            value={reps ?? ""}
            placeholder="reps"
            onChange={(e) => emit({ reps: num(e.target.value) })}
          />
        </>
      )}

      <button
        aria-label={done ? `Set ${index + 1} done. Tap to undo.` : `Mark set ${index + 1} done`}
        onClick={onToggle}
        className={`flex h-10 w-10 items-center justify-center justify-self-end rounded-xl border transition-colors ${
          done
            ? "border-accent bg-accent text-white"
            : "border-line bg-surface-2 text-ink-faint"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
          <path d="M5 13l4 4L19 7" />
        </svg>
      </button>
    </div>
  );
}
