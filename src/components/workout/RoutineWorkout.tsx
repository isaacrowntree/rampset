"use client";

/** Routine mode: the Strong layout. Exercise cards with set ROWS —
 * SET · PREVIOUS · KG · REPS · ✓ — prefilled from last session, fully
 * editable, add-set per exercise. The lifter prescribes; the app remembers. */

import { useState } from "react";
import type { Session, SessionExercise } from "@/db/session";
import { logSet, clearSet } from "@/db/session";
import { useUser } from "@/state/UserContext";
import { SetRow, type SetRowChange } from "../SetRow";

interface RowState {
  weightKg?: number;
  reps?: number;
  seconds?: number;
  done: boolean;
}

export function RoutineWorkout({
  session,
  onSetDone,
}: {
  session: Session;
  onSetDone: (restSeconds: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3.5 pt-1">
      {session.exercises.map((ex) => (
        <ExerciseCard
          key={ex.programExercise.id}
          ex={ex}
          workoutId={session.workout.id}
          onSetDone={onSetDone}
        />
      ))}
      <BodyWeightCard workoutId={session.workout.id} />
    </div>
  );
}

function ExerciseCard({
  ex,
  workoutId,
  onSetDone,
}: {
  ex: SessionExercise;
  workoutId: string;
  onSetDone: (rest: number) => void;
}) {
  const { user } = useUser();
  const timed = ex.exercise.kind === "timed";
  const bodyweight = ex.exercise.kind === "bodyweight";

  const [rows, setRows] = useState<RowState[]>(() =>
    ex.targets.map((t) => ({
      weightKg: t.weightKg,
      reps: t.reps,
      seconds: t.seconds,
      done: false,
    })),
  );

  const previous = (i: number): string => {
    const t = ex.targets[Math.min(i, ex.targets.length - 1)];
    if (!t) return "—";
    if (t.seconds) return `${t.seconds}s`;
    if (t.weightKg !== undefined && t.reps) return `${t.weightKg}kg × ${t.reps}`;
    if (t.reps) return `× ${t.reps}`;
    return "—";
  };

  const persist = async (i: number, row: RowState) => {
    if (!user) return;
    if (row.done) {
      await logSet(workoutId, user.id, ex.exercise.id, i, {
        weightKg: bodyweight || timed ? undefined : row.weightKg,
        reps: timed ? undefined : row.reps,
        seconds: timed ? row.seconds : undefined,
        targetReps: ex.programExercise.targetReps,
        targetSeconds: ex.programExercise.targetSeconds,
      });
    } else {
      await clearSet(workoutId, ex.exercise.id, i);
    }
  };

  const update = (i: number, patch: SetRowChange) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[i] = { ...copy[i], ...patch };
      if (copy[i].done) void persist(i, copy[i]);
      return copy;
    });
  };

  const toggle = (i: number) => {
    setRows((prev) => {
      const copy = [...prev];
      const next = { ...copy[i], done: !copy[i].done };
      copy[i] = next;
      void persist(i, next);
      if (next.done && ex.restSeconds > 0) onSetDone(ex.restSeconds);
      return copy;
    });
  };

  const addRow = () => {
    setRows((prev) => [...prev, { ...prev[prev.length - 1], done: false }]);
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="truncate text-[15.5px] font-semibold text-accent">
          {ex.exercise.name}
        </h2>
        {ex.restSeconds > 0 && (
          <span className="mono flex-none rounded-full border border-line px-2.5 py-0.5 text-[10.5px] text-ink-faint">
            rest {ex.restSeconds}s
          </span>
        )}
      </div>
      {ex.exercise.note && (
        <p className="mb-1 text-[12.5px] italic text-plate-15">“{ex.exercise.note}”</p>
      )}

      <div
        className={`mono grid gap-2 border-b border-line pb-1 pt-2 text-[10px] uppercase tracking-widest text-ink-faint ${
          timed || bodyweight
            ? "grid-cols-[28px_1fr_76px_44px]"
            : "grid-cols-[28px_1fr_76px_64px_44px]"
        }`}
      >
        <span>Set</span>
        <span>Previous</span>
        {timed ? <span className="text-center">sec</span> : bodyweight ? <span className="text-center">reps</span> : (
          <>
            <span className="text-center">kg</span>
            <span className="text-center">reps</span>
          </>
        )}
        <span className="text-right">✓</span>
      </div>

      <div className="divide-y divide-line/60">
        {rows.map((row, i) => (
          <SetRow
            key={i}
            index={i}
            previous={previous(i)}
            weightKg={row.weightKg}
            reps={row.reps}
            seconds={row.seconds}
            timed={timed}
            bodyweight={bodyweight}
            done={row.done}
            onChange={(v) => update(i, v)}
            onToggle={() => toggle(i)}
          />
        ))}
      </div>

      <button
        onClick={addRow}
        className="mt-2 w-full rounded-xl border border-dashed border-line py-2 text-[13px] font-medium text-ink-dim"
      >
        + Add set
      </button>
    </section>
  );
}

function BodyWeightCard({ workoutId }: { workoutId: string }) {
  const [value, setValue] = useState("");
  return (
    <label className="flex items-center justify-between rounded-2xl border border-line px-4 py-3.5">
      <span className="text-[15px]">Body weight</span>
      <input
        className="setfield max-w-[110px]"
        type="number"
        inputMode="decimal"
        step="0.05"
        placeholder="kg"
        value={value}
        onChange={async (e) => {
          setValue(e.target.value);
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v > 0) {
            const { db } = await import("@/db/db");
            await db.workouts.update(workoutId, { bodyWeightKg: v });
          }
        }}
      />
    </label>
  );
}
