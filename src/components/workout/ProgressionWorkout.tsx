"use client";

/** Program mode: StrongLifts-shaped. The app prescribes; you confirm.
 * Set plates + warmup tab + plate math.
 *
 * Logged sets are read live from IndexedDB — the DB is the single source of
 * truth, so tab switches, remounts, and resume all show what was logged. */

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import type { Session, SessionExercise } from "@/db/session";
import { logSet, clearSet } from "@/db/session";
import { useUser } from "@/state/UserContext";
import { SetPlate } from "../SetPlate";
import { PlateDiagram } from "../PlateDiagram";
import { platesPerSide, loadColor } from "@/lib/plates";
import { useGymPlates } from "@/lib/gymPlates";
import { roundStep, fmtWeight } from "@/lib/weightDisplay";
import { Stepper } from "../Stepper";
import { BodyWeightField } from "../BodyWeightField";
import { Sheet } from "../Sheet";
import { SegmentedControl } from "../SegmentedControl";

/** Rest after a failed set (missed reps) — 5 minutes, per SL guidance
 * (1:30 easy · 3:00 hard · 5:00 failed). */
const FAIL_REST_SECONDS = 300;
/** Warmup set index offset — warmups are keyed after work sets. */
const WARMUP_OFFSET = 100;

export function ProgressionWorkout({
  session,
  onSetDone,
  onProgramChange,
  programLocked = false,
}: {
  session: Session;
  onSetDone: (restSeconds: number) => void;
  onProgramChange: () => void;
  /** Editing a past workout: the exercise details (which rewrite the live
   * program) aren't offered. */
  programLocked?: boolean;
}) {
  const [tab, setTab] = useState<"workout" | "warmup">("workout");
  // The sheet tracks an id, not a snapshot — after a mid-workout edit
  // rebuilds the plan, it re-derives the fresh exercise from the session.
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = detailId
    ? (session.exercises.find((e) => e.programExercise.id === detailId) ?? null)
    : null;

  return (
    <div>
      <div className="mb-1 mt-2">
        <SegmentedControl
          label="Workout or warmup"
          value={tab}
          onChange={setTab}
          options={[
            { value: "workout", label: "Workout" },
            { value: "warmup", label: "Warmup" },
          ]}
        />
      </div>

      {tab === "workout" ? (
        <WorkTab
          session={session}
          onSetDone={onSetDone}
          onOpenDetail={programLocked ? undefined : (ex) => setDetailId(ex.programExercise.id)}
        />
      ) : (
        <WarmupTab session={session} onSetDone={onSetDone} />
      )}

      {detail && (
        <ExerciseSheet
          ex={detail}
          onClose={() => setDetailId(null)}
          onProgramChange={onProgramChange}
        />
      )}
    </div>
  );
}

/** Optimistic overlay: taps render instantly from local intent while the
 * async write + liveQuery round-trip catches up — rapid taps can't be
 * swallowed by a stale read. Intent always wins (it IS the user's input). */
function useIntentOverlay(logged: Map<number, number>) {
  const [intent, setIntent] = useState<Map<number, number | null>>(new Map());
  const valueAt = (i: number): number | null =>
    intent.has(i) ? intent.get(i)! : logged.has(i) ? logged.get(i)! : null;
  const setAt = (i: number, v: number | null) =>
    setIntent((prev) => new Map(prev).set(i, v));
  const knownBeyond = Math.max(
    0,
    ...[...logged.keys()].map((i) => i + 1),
    ...[...intent.entries()].filter(([, v]) => v !== null).map(([i]) => i + 1),
  );
  return { valueAt, setAt, knownBeyond };
}

/** Live map of setIndex → reps for one exercise in one workout. */
function useLoggedValues(workoutId: string, exerciseId: string, warmup: boolean) {
  return useLiveQuery(
    async () => {
      const sets = await db.sets
        .where({ workoutId })
        .and((s) => s.exerciseId === exerciseId)
        .toArray();
      const map = new Map<number, number>();
      for (const s of sets) {
        const isWarmupIndex = s.setIndex >= WARMUP_OFFSET;
        if (isWarmupIndex !== warmup) continue;
        map.set(isWarmupIndex ? s.setIndex - WARMUP_OFFSET : s.setIndex, s.reps ?? 0);
      }
      return map;
    },
    [workoutId, exerciseId, warmup],
    new Map<number, number>(),
  );
}

function WorkTab({
  session,
  onSetDone,
  onOpenDetail,
}: {
  session: Session;
  onSetDone: (rest: number) => void;
  onOpenDetail?: (ex: SessionExercise) => void;
}) {
  return (
    <div>
      {session.exercises.map((ex) => (
        <section key={`${session.workout.id}-${ex.programExercise.id}`} className="my-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="truncate text-[17px] font-semibold">{ex.exercise.name}</h2>
            {/* The load is what you check between sets — it leads, in ink. */}
            {onOpenDetail ? (
              <button
                onClick={() => onOpenDetail(ex)}
                aria-label={`${ex.exercise.name} details: ${formatTarget(ex)}`}
                className="row -my-1.5 -mr-2 flex flex-none items-center gap-1.5 rounded-lg px-2 py-2.5"
              >
                <TargetLabel ex={ex} />
                <svg width="8" height="13" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden>
                  <path d="M1 1l6 6-6 6" />
                </svg>
              </button>
            ) : (
              <TargetLabel ex={ex} />
            )}
          </div>
          {ex.exercise.note && (
            <p className="mb-2.5 -mt-1.5 text-[12.5px] italic text-plate-15">
              “{ex.exercise.note}”
            </p>
          )}
          <PlateRow ex={ex} workoutId={session.workout.id} onSetDone={onSetDone} />
        </section>
      ))}
      <BodyWeightField workoutId={session.workout.id} />
    </div>
  );
}

function PlateRow({
  ex,
  workoutId,
  onSetDone,
}: {
  ex: SessionExercise;
  workoutId: string;
  onSetDone: (rest: number) => void;
}) {
  const { user } = useUser();
  const logged = useLoggedValues(workoutId, ex.exercise.id, false);
  const { valueAt, setAt, knownBeyond } = useIntentOverlay(logged);

  // "+" adds a bonus set for TODAY only (an extra AMRAP/backoff), separate
  // from the program's prescribed count — that lives in the edit sheet.
  // Logged bonus sets persist through remounts because they're derived from
  // the DB (knownBeyond); an empty bonus set is just this component's intent.
  const prescribed = ex.targets.length;
  const [addedSets, setAddedSets] = useState(0);
  const totalSets = Math.max(prescribed + addedSets, knownBeyond);
  const targetReps = ex.programExercise.targetReps ?? 5;
  const gymPlates = useGymPlates();
  // Done sets wear the load's heaviest plate; bodyweight work wears the accent.
  const tone =
    ex.exercise.kind === "weighted" ? loadColor(ex.targets[0]?.weightKg, 20, gymPlates) : null;
  const bonusCount = totalSets - prescribed;
  // Once a lift is under way, ring the next empty prescribed set.
  const started = Array.from({ length: prescribed }, (_, i) => valueAt(i)).some((v) => v !== null);
  const firstEmpty = Array.from({ length: prescribed }, (_, i) => i).find((i) => valueAt(i) === null);
  const nextIndex = started ? firstEmpty : undefined;
  // Only an EMPTY trailing bonus set can be removed by "−"; a logged one must
  // be tapped back to empty first, so a mistaken remove can't drop real reps.
  const canRemove = bonusCount > 0 && valueAt(totalSets - 1) === null;
  const removeBonusSet = () => {
    if (!canRemove) return;
    if (typeof navigator !== "undefined") navigator.vibrate?.(10);
    setAddedSets((n) => Math.max(0, n - 1));
  };

  const handle = async (i: number, next: number | null) => {
    if (!user) return;
    setAt(i, next); // optimistic: the next tap computes from THIS value
    if (next === null) {
      await clearSet(workoutId, ex.exercise.id, i);
      return;
    }
    // Start the rest FIRST, synchronously in the tap gesture — the audio
    // context must be primed inside user activation, not after an await.
    if (ex.restSeconds > 0) {
      if (next === targetReps) onSetDone(ex.restSeconds);
      else onSetDone(Math.max(ex.restSeconds, FAIL_REST_SECONDS)); // missed reps → long rest
    }
    const t = ex.targets[Math.min(i, ex.targets.length - 1)];
    await logSet(workoutId, user.id, ex.exercise.id, i, {
      weightKg: t?.weightKg,
      reps: next,
      targetReps,
    });
  };

  return (
    // Six fixed columns so the standard 5 sets + "add" share one line on any
    // phone; the plates size themselves to the column. Extra sets wrap into
    // aligned rows of six.
    <>
      <div className="grid grid-cols-6 gap-2">
        {Array.from({ length: totalSets }, (_, i) => {
          const isBonus = i >= prescribed;
          // iOS-style corner ✕ on the trailing EMPTY bonus set. A logged one
          // must be tapped back to empty first — no silent data loss.
          const removable = isBonus && i === totalSets - 1 && valueAt(i) === null;
          const isNext = i === nextIndex;
          return (
            <div key={i} className="relative">
              <SetPlate
                target={targetReps}
                value={valueAt(i)}
                bonus={isBonus}
                tone={tone}
                upNext={isNext}
                onChange={(n) => handle(i, n)}
              />
              {removable && (
                <button
                  aria-label="Remove bonus set"
                  onClick={removeBonusSet}
                  className="absolute -right-1 -top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-surface-2 text-ink-dim shadow ring-1 ring-line transition-transform active:scale-90"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
        <button
          aria-label="Add a bonus set"
          onClick={() => setAddedSets((n) => n + 1)}
          className="flex aspect-square w-full items-center justify-center rounded-full text-[24px] font-light text-ink-faint outline-2 -outline-offset-2 outline-dashed outline-surface-3"
        >
          +
        </button>
      </div>
      {bonusCount > 0 && (
        <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">
          {bonusCount} bonus set{bonusCount === 1 ? "" : "s"} beyond the prescribed{" "}
          {prescribed}.{" "}
          {canRemove
            ? "Tap the ✕ to remove it."
            : "Tap a bonus set back to empty to remove it."}{" "}
          Change the prescription in the exercise’s details.
        </p>
      )}
    </>
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
            {(ex.targets[0]?.weightKg ?? 0) >= 20
              ? "No warmup needed at this weight. Two light sets with the empty bar if you like."
              : "No warmup needed at this weight. A couple of light sets if you like."}
          </p>
        </section>
      ))}
      {withWarmups.map((ex) => (
        <WarmupSection
          key={`${session.workout.id}-${ex.programExercise.id}`}
          ex={ex}
          workoutId={session.workout.id}
          onSetDone={onSetDone}
        />
      ))}
    </div>
  );
}

function WarmupSection({
  ex,
  workoutId,
  onSetDone,
}: {
  ex: SessionExercise;
  workoutId: string;
  onSetDone: (rest: number) => void;
}) {
  const { user } = useUser();
  const logged = useLoggedValues(workoutId, ex.exercise.id, true);
  const { valueAt, setAt } = useIntentOverlay(logged);
  const gymPlates = useGymPlates();

  return (
    <section className="my-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-base font-semibold">{ex.exercise.name}</h2>
        <span className="mono text-xs text-ink-faint">
          work: {ex.targets[0]?.weightKg}kg
        </span>
      </div>
      <div className="divide-y divide-line">
        {ex.warmups.map((w, i) => (
          <div key={i} className="flex items-center gap-3.5 py-2">
            <SetPlate
              size={44}
              tone={loadColor(w.weightKg, 20, gymPlates)}
              target={w.reps}
              value={valueAt(i)}
              onChange={async (n) => {
                if (!user) return;
                setAt(i, n);
                const setIndex = WARMUP_OFFSET + i;
                if (n === null) {
                  await clearSet(workoutId, ex.exercise.id, setIndex);
                  return;
                }
                await logSet(workoutId, user.id, ex.exercise.id, setIndex, {
                  weightKg: w.weightKg,
                  reps: n,
                  isWarmup: true,
                });
                if (n === w.reps) onSetDone(45);
              }}
            />
            <span className="mono flex-1 text-sm">
              {w.reps} × {w.weightKg}kg
            </span>
            <span className="mono text-[12.5px] text-ink-faint">{sideLabel(w.weightKg)}</span>
          </div>
        ))}
        <div className="flex items-center gap-3.5 py-3">
          <span aria-hidden className="w-11 flex-none" />
          <span className="mono flex-1 text-sm text-accent">
            {ex.programExercise.targetReps} × {ex.targets[0]?.weightKg}kg
          </span>
          <span className="mono text-[12.5px] text-accent">
            {sideLabel(ex.targets[0]?.weightKg)}
          </span>
        </div>
      </div>
    </section>
  );
}

function ExerciseSheet({
  ex,
  onClose,
  onProgramChange,
}: {
  ex: SessionExercise;
  onClose: () => void;
  onProgramChange: () => void;
}) {
  const pe = ex.programExercise;
  const timed = pe.targetSeconds !== undefined;
  const weighted = ex.exercise.kind === "weighted";

  // Local draft is the source of truth while the sheet is open: rapid
  // stepper taps accumulate here instantly, each persisting to the program
  // and rebuilding the session (targets + warmups) in the background.
  const [draft, setDraft] = useState({
    sets: pe.sets,
    reps: pe.targetReps ?? 5,
    seconds: pe.targetSeconds ?? 30,
    weightKg: pe.workingWeightKg ?? 0,
    incrementKg: pe.incrementKg ?? 0,
    deloadPct: pe.deloadPct ?? 0.1,
    deloadAfterFails: pe.deloadAfterFails ?? 3,
  });
  // A burst of taps fires before React re-renders; each must compute from
  // the previous tap's result, not the stale render value — otherwise two
  // quick taps only move one step ("sticks").
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Exercise cue (form reminder). Persists on blur, then rebuilds the plan so
  // the note shows under the exercise during the workout.
  const [note, setNote] = useState(ex.exercise.note ?? "");
  const saveNote = () => {
    void db.exercises.update(ex.exercise.id, { note: note.trim() }).then(onProgramChange);
  };

  const apply = (patch: (cur: typeof draft) => Partial<typeof draft>) => {
    if (typeof navigator !== "undefined") navigator.vibrate?.(10);
    const next = { ...draftRef.current, ...patch(draftRef.current) };
    draftRef.current = next;
    setDraft(next);
    void (async () => {
      await db.programExercises.update(pe.id, {
        sets: next.sets,
        ...(timed ? { targetSeconds: next.seconds } : { targetReps: next.reps }),
        ...(weighted
          ? {
              workingWeightKg: next.weightKg,
              incrementKg: next.incrementKg,
              deloadPct: next.deloadPct,
              deloadAfterFails: next.deloadAfterFails,
            }
          : {}),
      });
      onProgramChange();
    })();
  };

  const weight = weighted ? draft.weightKg : undefined;
  return (
    <Sheet label={`${ex.exercise.name} details`} onClose={onClose}>
      <>
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="disp text-[19px]">{ex.exercise.name}</h2>
          <button onClick={onClose} className="-mr-2 px-3 py-2 text-[17px] font-semibold text-accent">
            Done
          </button>
        </div>
        {weight !== undefined && weight >= 20 ? (
          // Bar territory: 20kg is the empty bar, so plate math applies.
          <>
            <p className="mono mb-3 text-xs text-ink-faint">
              {weight}kg · {sideLabel(weight)}
            </p>
            <PlateDiagram totalKg={weight} />
          </>
        ) : weight !== undefined && weight > 0 ? (
          <p className="text-sm text-ink-faint">
            <span className="mono text-ink">{weight}kg</span> — under bar weight,
            so no plate math. Dumbbells, a machine, or a dip belt.
          </p>
        ) : weight !== undefined && weight < 0 ? (
          <p className="text-sm text-ink-faint">
            <span className="mono text-ink">{Math.abs(weight)}kg assistance</span>{" "}
            — set the machine to take this much off your body weight.
          </p>
        ) : (
          <p className="text-sm text-ink-faint">Bodyweight — nothing to load.</p>
        )}
        <div className="mt-4 glass px-4 py-1.5">
          <Stepper
            label="Sets"
            value={draft.sets}
            display={String(draft.sets)}
            onStep={(d) => apply((c) => ({ sets: clamp(c.sets + d, 1, 10) }))}
          />
          {timed ? (
            <Stepper
              label="Seconds"
              value={draft.seconds}
              display={`${draft.seconds}s`}
              onStep={(d) => apply((c) => ({ seconds: clamp(c.seconds + d * 15, 15, 600) }))}
            />
          ) : (
            <Stepper
              label="Reps"
              value={draft.reps}
              display={String(draft.reps)}
              onStep={(d) => apply((c) => ({ reps: clamp(c.reps + d, 1, 30) }))}
            />
          )}
          {weighted && (
            <Stepper
              label="Weight"
              value={draft.weightKg}
              display={fmtWeight(draft.weightKg)}
              onStep={(d) =>
                apply((c) => ({ weightKg: roundStep(c.weightKg + d * 2.5) }))
              }
            />
          )}
        </div>
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-ink-faint">
          Changes apply to this workout, including warmups, and to future workouts.
        </p>

        <label className="eyebrow mb-1.5 mt-4 block px-4">Cue</label>
        <textarea
          data-selectable
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveNote}
          placeholder="A form reminder shown under this exercise during the workout"
          rows={2}
          className="w-full resize-none rounded-[12px] bg-fill p-3 text-[16px] leading-snug text-ink outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent"
        />
        {weighted && (
          <>
            <label className="eyebrow mb-1.5 mt-4 block px-4">Auto-progression</label>
            <div className="glass px-4 py-1.5">
              <Stepper
                label="Add per workout"
                value={draft.incrementKg}
                display={draft.incrementKg > 0 ? `+${draft.incrementKg}kg` : "manual"}
                onStep={(d) =>
                  apply((c) => ({ incrementKg: clamp(roundStep(c.incrementKg + d * 1.25), 0, 10) }))
                }
              />
              <Stepper
                label="Deload"
                value={draft.deloadPct}
                display={`−${Math.round(draft.deloadPct * 100)}%`}
                onStep={(d) =>
                  apply((c) => ({
                    deloadPct: Math.round(clamp(c.deloadPct + d * 0.05, 0.05, 0.25) * 100) / 100,
                  }))
                }
              />
              <Stepper
                label="Deload after"
                value={draft.deloadAfterFails}
                display={`${draft.deloadAfterFails} fail${draft.deloadAfterFails === 1 ? "" : "s"}`}
                onStep={(d) => apply((c) => ({ deloadAfterFails: clamp(c.deloadAfterFails + d, 1, 5) }))}
              />
            </div>
            <div className="mt-3">
              <Stat
                k="Next workout if you hit all reps"
                v={draft.incrementKg > 0 ? fmtWeight(roundStep(draft.weightKg + draft.incrementKg)) : "manual — weight stays"}
              />
            </div>
          </>
        )}
      </>
    </Sheet>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="glass px-4 py-3">
      <div className="eyebrow">{k}</div>
      <div className="disp mt-1 text-[17px]">{v}</div>
    </div>
  );
}

/** "● 27.5kg  5×5" — a pip in the load's plate color ties the done-set
 * color to the weight it stands for. */
function TargetLabel({ ex }: { ex: SessionExercise }) {
  const gymPlates = useGymPlates();
  const pe = ex.programExercise;
  const w = ex.targets[0]?.weightKg;
  const tone = ex.exercise.kind === "weighted" ? loadColor(w, 20, gymPlates) : null;
  return (
    <span className="flex items-baseline gap-1.5">
      {tone && (
        <span
          aria-hidden
          className="h-2.5 w-2.5 self-center rounded-full ring-1 ring-black/20"
          style={{ background: tone.fill }}
        />
      )}
      {w !== undefined && w !== 0 && (
        <span className="mono text-[17px] font-semibold text-ink">{w}kg</span>
      )}
      <span className="mono text-[15px] text-ink-dim">
        {pe.sets}×{pe.targetReps ?? ""}
      </span>
    </span>
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
