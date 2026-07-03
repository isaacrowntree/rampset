"use client";

/** Program mode: StrongLifts-shaped. The app prescribes; you confirm.
 * Set plates + warmup tab + plate math. */

import { useState } from "react";
import type { Session, SessionExercise } from "@/db/session";
import { logSet, clearSet } from "@/db/session";
import { useUser } from "@/state/UserContext";
import { SetPlate } from "../SetPlate";
import { PlateDiagram } from "../PlateDiagram";
import { platesPerSide } from "@/lib/plates";

export function ProgressionWorkout({
  session,
  onSetDone,
}: {
  session: Session;
  onSetDone: (restSeconds: number) => void;
}) {
  const [tab, setTab] = useState<"workout" | "warmup">("workout");
  const [detail, setDetail] = useState<SessionExercise | null>(null);

  return (
    <div>
      <div className="mb-2 flex border-b border-line" role="tablist">
        {(["workout", "warmup"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px flex-1 border-b-2 py-3 text-center text-sm font-medium capitalize ${
              tab === t ? "border-accent text-ink" : "border-transparent text-ink-faint"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "workout" ? (
        <WorkTab session={session} onSetDone={onSetDone} onOpenDetail={setDetail} />
      ) : (
        <WarmupTab session={session} onSetDone={onSetDone} />
      )}

      {detail && <ExerciseSheet ex={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function WorkTab({
  session,
  onSetDone,
  onOpenDetail,
}: {
  session: Session;
  onSetDone: (rest: number) => void;
  onOpenDetail: (ex: SessionExercise) => void;
}) {
  const { user } = useUser();
  const [bodyWeight, setBodyWeight] = useState<string>("");

  return (
    <div>
      {session.exercises.map((ex) => (
        <section key={ex.programExercise.id} className="my-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">{ex.exercise.name}</h2>
            <button
              onClick={() => onOpenDetail(ex)}
              className="mono flex items-center gap-1 py-1 text-[13px] text-accent"
            >
              {formatTarget(ex)}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
          <PlateRow ex={ex} workoutId={session.workout.id} onSetDone={onSetDone} />
        </section>
      ))}

      <label className="mt-6 flex items-center justify-between rounded-2xl border border-line px-4 py-3.5">
        <span className="text-[15px]">Body weight</span>
        <input
          className="setfield max-w-[110px]"
          type="number"
          inputMode="decimal"
          step="0.05"
          placeholder="kg"
          value={bodyWeight}
          onChange={async (e) => {
            setBodyWeight(e.target.value);
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0 && user) {
              const { db } = await import("@/db/db");
              await db.workouts.update(session.workout.id, { bodyWeightKg: v });
            }
          }}
        />
      </label>
    </div>
  );
}

function PlateRow({
  ex,
  workoutId,
  onSetDone,
  warmup = false,
}: {
  ex: SessionExercise;
  workoutId: string;
  onSetDone: (rest: number) => void;
  warmup?: boolean;
}) {
  const { user } = useUser();
  const targets = warmup ? ex.warmups : ex.targets;
  const [values, setValues] = useState<(number | null)[]>(() => targets.map(() => null));
  const [extraSets, setExtraSets] = useState(0);

  const allTargets = warmup
    ? targets
    : [...targets, ...Array.from({ length: extraSets }, () => targets[targets.length - 1] ?? {})];

  const handle = async (i: number, next: number | null) => {
    if (!user) return;
    setValues((prev) => {
      const copy = [...prev];
      while (copy.length <= i) copy.push(null);
      copy[i] = next;
      return copy;
    });
    const t = allTargets[i] as { weightKg?: number; reps?: number };
    const setIndex = warmup ? i + 100 : i; // warmups keyed after work sets
    if (next === null) {
      await clearSet(workoutId, ex.exercise.id, setIndex);
      return;
    }
    await logSet(workoutId, user.id, ex.exercise.id, setIndex, {
      weightKg: t.weightKg,
      reps: next,
      isWarmup: warmup,
      targetReps: warmup ? undefined : ex.programExercise.targetReps,
    });
    // Full target hit on a fresh tap → start rest.
    const target = warmup ? (allTargets[i] as { reps?: number }).reps : ex.programExercise.targetReps;
    if (next === (target ?? 0) && ex.restSeconds > 0) onSetDone(ex.restSeconds);
  };

  return (
    <div className="flex flex-wrap gap-2.5">
      {allTargets.map((t, i) => (
        <SetPlate
          key={i}
          target={(t as { reps?: number }).reps ?? ex.programExercise.targetReps ?? 5}
          value={values[i] ?? null}
          onChange={(n) => handle(i, n)}
        />
      ))}
      {!warmup && (
        <button
          aria-label="Add a set"
          onClick={() => setExtraSets((n) => n + 1)}
          className="flex h-14 w-14 flex-none items-center justify-center rounded-full border-4 border-dashed border-[#2E3036] text-[22px] text-ink-faint"
        >
          +
        </button>
      )}
    </div>
  );
}

function WarmupTab({
  session,
  onSetDone,
}: {
  session: Session;
  onSetDone: (rest: number) => void;
}) {
  const withWarmups = session.exercises.filter((e) => e.warmups.length > 0);
  const without = session.exercises.filter(
    (e) => e.warmups.length === 0 && e.exercise.kind === "weighted",
  );

  return (
    <div>
      {without.map((ex) => (
        <section key={ex.programExercise.id} className="my-4">
          <h2 className="mb-1 text-base font-semibold">{ex.exercise.name}</h2>
          <p className="text-[13px] leading-relaxed text-ink-faint">
            No warmup at this weight. Two light sets with the empty bar if you want them.
          </p>
        </section>
      ))}
      {withWarmups.map((ex) => (
        <section key={ex.programExercise.id} className="my-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-base font-semibold">{ex.exercise.name}</h2>
            <span className="mono text-xs text-ink-faint">
              work: {ex.targets[0]?.weightKg}kg
            </span>
          </div>
          <div className="divide-y divide-line">
            {ex.warmups.map((w, i) => (
              <WarmupRow
                key={i}
                ex={ex}
                index={i}
                reps={w.reps}
                weightKg={w.weightKg}
                workoutId={session.workout.id}
                onSetDone={onSetDone}
              />
            ))}
            <div className="flex items-center gap-3.5 py-3">
              <span className="mono flex-1 text-sm text-accent">
                {ex.programExercise.targetReps} × {ex.targets[0]?.weightKg}kg
              </span>
              <span className="mono text-[12.5px] text-accent">
                {sideLabel(ex.targets[0]?.weightKg)}
              </span>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

function WarmupRow({
  ex,
  index,
  reps,
  weightKg,
  workoutId,
  onSetDone,
}: {
  ex: SessionExercise;
  index: number;
  reps: number;
  weightKg: number;
  workoutId: string;
  onSetDone: (rest: number) => void;
}) {
  const { user } = useUser();
  const [done, setDone] = useState<number | null>(null);
  return (
    <div className="flex items-center gap-3.5 py-2">
      <SetPlate
        size={40}
        target={reps}
        value={done}
        onChange={async (n) => {
          setDone(n);
          if (!user) return;
          const setIndex = 100 + index;
          if (n === null) {
            await clearSet(workoutId, ex.exercise.id, setIndex);
          } else {
            await logSet(workoutId, user.id, ex.exercise.id, setIndex, {
              weightKg,
              reps: n,
              isWarmup: true,
            });
            if (n === reps) onSetDone(45);
          }
        }}
      />
      <span className="mono flex-1 text-sm">
        {reps} × {weightKg}kg
      </span>
      <span className="mono text-[12.5px] text-ink-faint">{sideLabel(weightKg)}</span>
    </div>
  );
}

function ExerciseSheet({ ex, onClose }: { ex: SessionExercise; onClose: () => void }) {
  const weight = ex.targets[0]?.weightKg;
  return (
    <div
      className="fixed inset-0 z-50 mx-auto flex max-w-md flex-col justify-end bg-black/70"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`${ex.exercise.name} details`}
        className="rounded-t-3xl border border-line bg-surface p-5 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="disp text-[19px]">{ex.exercise.name}</h2>
          <button onClick={onClose} className="px-2 py-1 text-sm text-ink-dim">
            Close
          </button>
        </div>
        {weight !== undefined && weight > 0 ? (
          <>
            <p className="mono mb-3 text-xs text-ink-faint">
              {weight}kg · {sideLabel(weight)}
            </p>
            <PlateDiagram totalKg={weight} />
          </>
        ) : (
          <p className="text-sm text-ink-faint">Bodyweight — nothing to load.</p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat k="Sets × reps" v={`${ex.programExercise.sets}×${ex.programExercise.targetReps ?? "—"}`} />
          <Stat
            k="Next workout"
            v={
              weight !== undefined && ex.programExercise.incrementKg
                ? `${weight + ex.programExercise.incrementKg}kg`
                : "—"
            }
          />
          <Stat k="Progression" v={ex.programExercise.incrementKg ? `+${ex.programExercise.incrementKg}kg / workout` : "manual"} />
          <Stat k="Deload" v={`−${Math.round((ex.programExercise.deloadPct ?? 0.1) * 100)}% after ${ex.programExercise.deloadAfterFails ?? 3} fails`} />
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-2xl border border-line bg-black px-4 py-3">
      <div className="eyebrow">{k}</div>
      <div className="disp mt-1 text-[17px]">{v}</div>
    </div>
  );
}

function formatTarget(ex: SessionExercise): string {
  const pe = ex.programExercise;
  const w = ex.targets[0]?.weightKg;
  const scheme = `${pe.sets}×${pe.targetReps ?? ""}`;
  if (w === undefined || w === 0) return scheme;
  return `${scheme} ${w}kg`;
}

function sideLabel(totalKg?: number): string {
  if (totalKg === undefined) return "";
  const plates = platesPerSide(totalKg, 20);
  if (!plates) return "";
  if (plates.length === 0) return "empty bar";
  const perSide = (totalKg - 20) / 2;
  return `${perSide}kg/side`;
}
