"use client";

/** Madcow mode: a prescribed ramp checklist. Each exercise shows its climbing
 * sets (weight × reps) up to the top; tap a set to log it at the prescribed
 * weight. The top/PR set is highlighted and the back-off is labeled.
 *
 * Like ProgressionWorkout, logged truth is live from IndexedDB (useLiveQuery)
 * with a thin optimistic overlay so rapid taps aren't swallowed. */

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import type { Session, SessionExercise } from "@/db/session";
import { logSet, clearSet } from "@/db/session";
import { useUser } from "@/state/UserContext";
import { BodyWeightField } from "../BodyWeightField";
import { rampForRole, type MadcowRole, type RampSet } from "@/lib/madcow";
import { fmtWeight } from "@/lib/weightDisplay";

export function MadcowWorkout({
  session,
  onSetDone,
}: {
  session: Session;
  onSetDone: (restSeconds: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3.5 pt-1">
      {session.exercises.map((ex) => (
        <MadcowCard
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

function MadcowCard({
  ex,
  workoutId,
  onSetDone,
}: {
  ex: SessionExercise;
  workoutId: string;
  onSetDone: (rest: number) => void;
}) {
  const { user } = useUser();
  const pe = ex.programExercise;
  const top = pe.workingWeightKg ?? 0;
  const ramp = rampForRole(
    (pe.madcowRole ?? "heavy") as MadcowRole,
    top,
    pe.incrementKg ?? 2.5,
  );

  const logged = useLiveQuery(
    async () => {
      const sets = await db.sets
        .where({ workoutId })
        .and((s) => s.exerciseId === ex.exercise.id && !s.isWarmup)
        .toArray();
      return new Set(sets.map((s) => s.setIndex));
    },
    [workoutId, ex.exercise.id],
    new Set<number>(),
  );

  const [intent, setIntent] = useState<Map<number, boolean>>(new Map());
  const isDone = (i: number) => (intent.has(i) ? intent.get(i)! : logged.has(i));

  const toggle = async (i: number, set: RampSet) => {
    if (!user) return;
    const next = !isDone(i);
    setIntent((m) => new Map(m).set(i, next));
    if (typeof navigator !== "undefined") navigator.vibrate?.(10);
    if (next) {
      if (ex.restSeconds > 0) onSetDone(ex.restSeconds);
      await logSet(workoutId, user.id, ex.exercise.id, i, {
        weightKg: set.weightKg,
        reps: set.reps,
        targetReps: set.reps,
      });
    } else {
      await clearSet(workoutId, ex.exercise.id, i);
    }
  };

  return (
    <section className="glass p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="disp text-[16px]">{ex.exercise.name}</h2>
        <span className="mono text-xs text-ink-faint">top {fmtWeight(top)}</span>
      </div>
      {ex.exercise.note && (
        <p className="mb-1 text-[12.5px] italic text-plate-15">“{ex.exercise.note}”</p>
      )}
      <div className="mt-1.5 flex flex-col">
        {ramp.map((set, i) => (
          <RampRow
            key={i}
            set={set}
            done={isDone(i)}
            onToggle={() => toggle(i, set)}
          />
        ))}
      </div>
    </section>
  );
}

function RampRow({
  set,
  done,
  onToggle,
}: {
  set: RampSet;
  done: boolean;
  onToggle: () => void;
}) {
  const label =
    set.kind === "top" ? "top set" : set.kind === "backoff" ? "back-off" : null;
  return (
    <button
      onClick={onToggle}
      aria-label={`${done ? "Undo" : "Log"} ${set.kind === "top" ? "top set " : ""}${fmtWeight(set.weightKg)} for ${set.reps} reps`}
      aria-pressed={done}
      className="flex items-center gap-3 border-b border-line py-2.5 text-left last:border-b-0"
    >
      <Check done={done} kind={set.kind} />
      <span className="flex-1">
        <span
          className={`disp text-[15px] ${set.kind === "ramp" && !done ? "text-ink-dim" : "text-ink"}`}
        >
          {fmtWeight(set.weightKg)}
        </span>
        <span className="text-[13.5px] text-ink-faint"> × {set.reps}</span>
      </span>
      {label && (
        <span
          className={`mono text-[11px] ${set.kind === "top" ? "text-accent" : "text-ink-faint"}`}
        >
          {label}
        </span>
      )}
    </button>
  );
}

function Check({ done, kind }: { done: boolean; kind: RampSet["kind"] }) {
  if (done) {
    return (
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent text-on-accent">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5 10 17.5 19 7" />
        </svg>
      </span>
    );
  }
  const top = kind === "top";
  return (
    <span
      className={`h-7 w-7 flex-none rounded-full border-2 ${
        top ? "border-accent bg-accent-soft" : "border-line"
      }`}
    />
  );
}
