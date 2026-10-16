"use client";

/** Routine mode: the Strong layout. Exercise cards with set ROWS —
 * SET · PREVIOUS · KG · REPS · ✓ — prefilled from last session, fully
 * editable, add-set per exercise. The lifter prescribes; the app remembers.
 *
 * Persisted state (done flags, logged values) derives LIVE from IndexedDB
 * via useLiveQuery; React state holds only uncommitted drafts. No hydration
 * effect, nothing to reconcile — resume and remounts are correct by
 * construction, and side effects live in event handlers. */

import { useState } from "react";
import type { Session, SessionExercise } from "@/db/session";
import { logSet, clearSet } from "@/db/session";
import { db } from "@/db/db";
import { useLiveQuery } from "dexie-react-hooks";
import { useUser } from "@/state/UserContext";
import { SetRow, type SetRowChange } from "../SetRow";
import { BodyWeightField } from "../BodyWeightField";

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
          key={`${session.workout.id}-${ex.programExercise.id}`}
          ex={ex}
          workoutId={session.workout.id}
          onSetDone={onSetDone}
        />
      ))}
      <BodyWeightField workoutId={session.workout.id} />
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

  // Persisted truth, live from the DB.
  const logged = useLiveQuery(
    async () => {
      const sets = await db.sets
        .where({ workoutId })
        .and((s) => s.exerciseId === ex.exercise.id && !s.isWarmup)
        .toArray();
      return new Map(sets.map((s) => [s.setIndex, s]));
    },
    [workoutId, ex.exercise.id],
    new Map<number, import("@/lib/types").SetEntry>(),
  );

  // Uncommitted edits only (numbers being typed before/after logging).
  const [drafts, setDrafts] = useState<Map<number, SetRowChange>>(new Map());
  const [addedRows, setAddedRows] = useState(0);

  const loggedBeyond = Math.max(0, ...[...logged.keys()].map((i) => i + 1));
  const rowCount = Math.max(ex.targets.length + addedRows, loggedBeyond);

  const valuesFor = (i: number): RowState => {
    const draft = drafts.get(i);
    const persisted = logged.get(i);
    const target = ex.targets[Math.min(i, ex.targets.length - 1)] ?? {};
    return {
      weightKg: draft?.weightKg ?? persisted?.weightKg ?? target.weightKg,
      reps: draft?.reps ?? persisted?.reps ?? target.reps,
      seconds: draft?.seconds ?? persisted?.seconds ?? target.seconds,
      done: logged.has(i),
    };
  };

  const persist = async (i: number, row: RowState) => {
    if (!user) return;
    await logSet(workoutId, user.id, ex.exercise.id, i, {
      weightKg: bodyweight || timed ? undefined : row.weightKg,
      reps: timed ? undefined : row.reps,
      seconds: timed ? row.seconds : undefined,
      targetReps: ex.programExercise.targetReps,
      targetSeconds: ex.programExercise.targetSeconds,
    });
  };

  const update = (i: number, patch: SetRowChange) => {
    const next = new Map(drafts);
    next.set(i, { ...next.get(i), ...patch });
    setDrafts(next);
    // Already logged? Keep the DB row in step with the edit.
    if (logged.has(i)) void persist(i, { ...valuesFor(i), ...patch, done: true });
  };

  const toggle = (i: number) => {
    if (logged.has(i)) {
      void clearSet(workoutId, ex.exercise.id, i);
      return;
    }
    void persist(i, valuesFor(i));
    if (ex.restSeconds > 0) onSetDone(ex.restSeconds);
  };

  const addRow = () => setAddedRows((n) => n + 1);

  /** "Previous" column: what the last finished session did for this slot. */
  const previous = (i: number): string => {
    const t = ex.targets[Math.min(i, ex.targets.length - 1)];
    if (!t) return "—";
    if (t.seconds) return `${t.seconds}s`;
    if (t.weightKg !== undefined && t.reps) return `${t.weightKg}kg × ${t.reps}`;
    if (t.reps) return `× ${t.reps}`;
    return "—";
  };

  return (
    <section className="glass p-4">
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
        className={`grid gap-2 border-b border-line pb-1 pt-2 text-[12px] font-semibold text-ink-faint ${
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
        {Array.from({ length: rowCount }, (_, i) => {
          const row = valuesFor(i);
          return (
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
          );
        })}
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

