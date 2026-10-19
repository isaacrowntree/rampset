"use client";

import { Chevron } from "@/components/Chevron";
import { Switch } from "@/components/Switch";
import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, newId } from "@/db/db";
import { useUser } from "@/state/UserContext";
import { AppHeader } from "@/components/AppHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Sheet } from "@/components/Sheet";
import { Stepper } from "@/components/Stepper";
import { fmtWeight } from "@/lib/weightDisplay";
import { scheduleBackup } from "@/lib/backupAfterEdit";
import { addDay, deleteDay, moveExercise, renameDay } from "@/db/programEdit";
import { getActiveWorkout } from "@/db/activeWorkout";
import { FIELD } from "@/components/ui";
import type {
  ProgramExercise,
  Exercise,
  ProgramDay,
  ProgramMode,
} from "@/lib/types";

export default function ProgramPage() {
  const { user } = useUser();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingDayId, setAddingDayId] = useState<string | null>(null);
  // A day id, "new" for the add-day sheet, or null.
  const [dayEditing, setDayEditing] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    if (!user) return null;
    const program = await db.programs.where({ userId: user.id }).first();
    if (!program) return null;
    const days = await db.programDays
      .where({ programId: program.id })
      .sortBy("position");
    const detail = new Map<string, { pe: ProgramExercise; ex: Exercise }[]>();
    for (const day of days) {
      const pes = await db.programExercises
        .where({ programDayId: day.id })
        .sortBy("position");
      const rows: { pe: ProgramExercise; ex: Exercise }[] = [];
      for (const pe of pes) {
        const ex = await db.exercises.get(pe.exerciseId);
        if (ex) rows.push({ pe, ex });
      }
      detail.set(day.id, rows);
    }
    const allExercises = await db.exercises.where({ userId: user.id }).sortBy("name");
    const activeDayId = (await getActiveWorkout(user.id))?.programDayId;
    return { program, days, detail, allExercises, activeDayId };
  }, [user?.id]);

  if (!user || !data) return <PageSkeleton title="Program" />;
  const { program, days, detail, allExercises, activeDayId } = data;
  const isProgression = program.mode === "progression";
  // Only a custom routine is free-form: 5×5 and Madcow rotate through their
  // written days and progress by them.
  const isRoutine = program.mode === "routine";

  // Program edits aren't in the finished-workout sync path — refresh the
  // cloud snapshot so a new device restores them.
  const onChanged = () => scheduleBackup(user.id);

  const editingRow = editingId
    ? [...detail.values()].flat().find((r) => r.pe.id === editingId)
    : undefined;
  const addingDay = addingDayId ? days.find((d) => d.id === addingDayId) : undefined;
  const addingRows = addingDay ? detail.get(addingDay.id) ?? [] : [];
  const editingDay = dayEditing && dayEditing !== "new" ? days.find((d) => d.id === dayEditing) : undefined;
  const editingDayRows = editingRow ? detail.get(editingRow.pe.programDayId) ?? [] : [];

  return (
    <div className="pb-8">
      <AppHeader
        title="Program"
        sub={`${program.name} · ${
          program.mode === "progression"
            ? "Automatic progression"
            : program.mode === "madcow"
              ? "Weekly progression"
              : "Prefilled from last workout"
        }`}
      />
      <div className="flex flex-col gap-6">
        {days.map((day) => {
          const rows = detail.get(day.id) ?? [];
          return (
            <section key={day.id}>
              <div className="mb-2 flex items-baseline justify-between gap-3 px-4">
                <h2 className="eyebrow min-w-0 truncate">{day.name}</h2>
                {isRoutine && (
                  <button
                    onClick={() => setDayEditing(day.id)}
                    aria-label={`Edit day ${day.name}`}
                    className="-my-3 -mr-3 min-h-[44px] flex-none px-3 text-[15px] text-accent"
                  >
                    Edit
                  </button>
                )}
              </div>
              <div className="glass overflow-hidden">
                {rows.map(({ pe, ex }) => (
                  <button
                    key={pe.id}
                    onClick={() => setEditingId(pe.id)}
                    aria-label={`Edit ${ex.name}`}
                    className="row flex min-h-[44px] w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left"
                  >
                    <span className="min-w-0 truncate text-[17px]">{ex.name}</span>
                    <span className="flex flex-none items-center gap-2">
                      <span className="mono text-[15px] text-ink-dim">
                        {rowSummary(pe, ex, program.mode !== "routine")}
                      </span>
                      <Chevron />
                    </span>
                  </button>
                ))}
                {rows.length === 0 && (
                  <p className="border-b border-line px-4 py-3 text-[15px] text-ink-faint">
                    No exercises yet.
                  </p>
                )}
                <button
                  onClick={() => setAddingDayId(day.id)}
                  className="row flex min-h-[44px] w-full items-center gap-2 px-4 py-3 text-left text-[17px] text-accent"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Add exercise
                </button>
              </div>
            </section>
          );
        })}

        {isRoutine && (
          <button
            onClick={() => setDayEditing("new")}
            className="glass row flex min-h-[44px] w-full items-center gap-2 px-4 py-3 text-left text-[17px] text-accent"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add day
          </button>
        )}

        <section>
          <h2 className="eyebrow mb-2 px-4">Progression</h2>
          <div className="glass overflow-hidden">
            {isProgression && (
              <label className="flex min-h-[44px] items-center justify-between gap-3 border-b border-line px-4 py-3">
                <span>
                  <span className="block text-[17px]">Linked lifts</span>
                  <span className="block text-[13px] text-ink-faint">
                    One chain per exercise: a squat success advances squat on
                    every day. Off keeps per-day weights.
                  </span>
                </span>
                <Switch
                  label="Linked lifts"
                  // The engine links progression-mode programs unless told
                  // otherwise — the switch must show that default, not "off".
                  checked={program.linkedProgression ?? program.mode === "progression"}
                  onChange={async (checked) => {
                    await db.programs.update(program.id, { linkedProgression: checked });
                    onChanged();
                  }}
                />
              </label>
            )}
            <p className="px-4 py-3 text-[13px] leading-relaxed text-ink-faint">
              {isProgression
                ? "Weights go up automatically after every successful workout. After three failed workouts in a row the weight drops 10%, and repeated stalls drop from 5×5 to 3×5, then 1×5. Tap any exercise to change its sets, reps or weight."
                : "No automatic progression. Every set prefills from your last workout, and you change the numbers as you go. Tap any exercise to change its sets, reps or order."}
            </p>
          </div>
        </section>
      </div>

      {editingRow && (
        <ProgramExerciseSheet
          pe={editingRow.pe}
          ex={editingRow.ex}
          mode={program.mode}
          // Reordering is part of shaping a routine; guided days stay as written.
          position={
            isRoutine
              ? {
                  index: editingDayRows.findIndex((r) => r.pe.id === editingRow.pe.id),
                  count: editingDayRows.length,
                }
              : undefined
          }
          onChanged={onChanged}
          onClose={() => setEditingId(null)}
        />
      )}
      {dayEditing === "new" && (
        <NewDaySheet
          suggested={`Day ${days.length + 1}`}
          onAdd={async (name) => {
            await addDay(program.id, name);
            onChanged();
            setDayEditing(null);
          }}
          onClose={() => setDayEditing(null)}
        />
      )}
      {editingDay && (
        <DaySheet
          day={editingDay}
          exerciseCount={(detail.get(editingDay.id) ?? []).length}
          canDelete={days.length > 1 && editingDay.id !== activeDayId}
          inProgress={editingDay.id === activeDayId}
          onRename={async (name) => {
            await renameDay(editingDay.id, name);
            onChanged();
          }}
          onDelete={async () => {
            await deleteDay(editingDay.id);
            onChanged();
            setDayEditing(null);
          }}
          onClose={() => setDayEditing(null)}
        />
      )}
      {addingDay && (
        <AddExerciseSheet
          userId={user.id}
          day={addingDay}
          mode={program.mode}
          existingIds={new Set(addingRows.map((r) => r.ex.id))}
          nextPosition={Math.max(-1, ...addingRows.map((r) => r.pe.position)) + 1}
          allExercises={allExercises}
          onChanged={onChanged}
          onClose={() => setAddingDayId(null)}
        />
      )}
    </div>
  );
}

function rowSummary(pe: ProgramExercise, ex: Exercise, showWeight: boolean): string {
  const weight =
    showWeight && ex.kind === "weighted" && pe.workingWeightKg !== undefined
      ? ` · ${fmtWeight(pe.workingWeightKg)}`
      : "";

  // Madcow rows ramp (and the intensity day mixes rep counts), so "6×5" would
  // misread as flat sets — describe the day instead.
  if (pe.madcowRole) {
    const scheme =
      pe.madcowRole === "intensity"
        ? "ramp + PR"
        : pe.madcowRole === "light"
          ? `${pe.sets}×5 light`
          : `${pe.sets}×5 ramp`;
    return `${scheme}${weight}`;
  }

  const scheme = pe.targetSeconds
    ? `${pe.sets}×${pe.targetSeconds}s`
    : `${pe.sets}×${pe.targetReps ?? ""}`;
  return `${scheme}${weight}`;
}

function ProgramExerciseSheet({
  pe,
  ex,
  mode,
  position,
  onChanged,
  onClose,
}: {
  pe: ProgramExercise;
  ex: Exercise;
  mode: ProgramMode;
  /** Where it sits in its day — present when the day can be reordered. */
  position?: { index: number; count: number };
  onChanged: () => void;
  onClose: () => void;
}) {
  const timed = pe.targetSeconds !== undefined || ex.kind === "timed";
  const weighted = ex.kind === "weighted";
  const showWeight = weighted && mode === "progression";

  const [draft, setDraft] = useState({
    sets: pe.sets,
    reps: pe.targetReps ?? 5,
    seconds: pe.targetSeconds ?? 30,
    restSeconds: pe.restSeconds ?? ex.restSeconds ?? 90,
  });
  // `apply` is the only writer, and keeps the ref current itself — so a burst
  // of taps each steps from the last, not from a stale render.
  const draftRef = useRef(draft);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const apply = (patch: (cur: typeof draft) => Partial<typeof draft>) => {
    if (typeof navigator !== "undefined") navigator.vibrate?.(10);
    const next = { ...draftRef.current, ...patch(draftRef.current) };
    draftRef.current = next;
    setDraft(next);
    void db.programExercises
      .update(pe.id, {
        sets: next.sets,
        ...(timed ? { targetSeconds: next.seconds } : { targetReps: next.reps }),
        restSeconds: next.restSeconds,
      })
      .then(onChanged);
  };

  const remove = async () => {
    await db.programExercises.delete(pe.id);
    onChanged();
    onClose();
  };

  return (
    <Sheet label={`Edit ${ex.name}`} onClose={onClose}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="disp text-[19px]">{ex.name}</h2>
        <button onClick={onClose} className="-mr-2 px-3 py-2 text-[17px] font-semibold text-accent">
          Done
        </button>
      </div>

      <div className="glass px-4 py-1.5">
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
        <Stepper
          label="Rest"
          value={draft.restSeconds}
          display={fmtRest(draft.restSeconds)}
          onStep={(d) => apply((c) => ({ restSeconds: clamp(c.restSeconds + d * 15, 0, 600) }))}
        />
      </div>

      {showWeight && (
        <div className="mt-3 flex items-center justify-between glass px-4 py-3">
          <span className="text-[14px] text-ink-dim">Starting weight</span>
          <WeightField pe={pe} ex={ex} onChanged={onChanged} />
        </div>
      )}
      {weighted && mode === "routine" && (
        <p className="mt-2 px-1 text-[12px] text-ink-faint">
          Weights prefill from your last session — set them as you train.
        </p>
      )}
      {weighted && mode === "madcow" && (
        <p className="mt-2 px-1 text-[12px] text-ink-faint">
          Madcow ramps each set to your top; the top advances weekly on the
          Friday PR set.
        </p>
      )}

      {position && position.count > 1 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {([
            [-1, "Move up", position.index === 0],
            [1, "Move down", position.index === position.count - 1],
          ] as const).map(([dir, label, disabled]) => (
            // aria-disabled, not disabled: reaching the end mustn't throw
            // focus out of the button just pressed.
            <button
              key={label}
              aria-disabled={disabled}
              onClick={() => !disabled && void moveExercise(pe.id, dir).then(onChanged)}
              className="glass py-3 text-[15px] text-accent aria-disabled:text-ink-faint"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {position && position.count > 1 && (
        <p aria-live="polite" className="mt-2 px-1 text-[12px] text-ink-faint">
          {position.index + 1} of {position.count} in this day
        </p>
      )}

      <button
        onClick={() => {
          if (confirmRemove) void remove();
          else setConfirmRemove(true);
        }}
        className={`mt-5 w-full rounded-full py-3.5 text-[15px] font-semibold ${
          confirmRemove ? "bg-plate-25 text-black" : "glass text-danger"
        }`}
      >
        {confirmRemove ? `Remove ${ex.name} — tap to confirm` : "Remove from program"}
      </button>
    </Sheet>
  );
}

/** Weight input with an assist toggle (iOS's decimal keypad has no minus
 * key, so assisted/negative weights need an explicit control). */
function WeightField({
  pe,
  ex,
  onChanged,
}: {
  pe: ProgramExercise;
  ex: Exercise;
  onChanged: () => void;
}) {
  const stored = pe.workingWeightKg ?? 0;
  const [assisted, setAssisted] = useState(stored < 0);

  const save = async (magnitude: number, assist: boolean) => {
    await db.programExercises.update(pe.id, {
      workingWeightKg: assist ? -Math.abs(magnitude) : Math.abs(magnitude),
    });
    onChanged();
  };

  return (
    <span className="mono flex items-center gap-1.5 text-[13px] text-ink">
      <button
        aria-pressed={assisted}
        aria-label={`${ex.name}: assisted — machine takes weight off`}
        onClick={() => {
          const next = !assisted;
          setAssisted(next);
          if (stored !== 0) void save(Math.abs(stored), next);
        }}
        className={`rounded-full border px-2 py-0.5 text-[10.5px] ${
          assisted ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-faint"
        }`}
      >
        assist
      </button>
      {assisted && <span aria-hidden>−</span>}
      <input
        className="setfield max-w-[72px]"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        type="number"
        inputMode="decimal"
        step="0.5"
        enterKeyHint="done"
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label={`${ex.name} starting weight in kg${assisted ? " (assistance)" : ""}`}
        defaultValue={Math.abs(stored)}
        onBlur={async (e) => {
          const raw = e.target.value.trim();
          const v = Number(raw);
          if (raw === "" || !Number.isFinite(v)) {
            e.target.value = String(Math.abs(stored));
            return;
          }
          const assist = assisted || v < 0;
          if (assist !== assisted) setAssisted(assist);
          e.target.value = String(Math.abs(v));
          await save(v, assist);
        }}
      />
      kg
    </span>
  );
}

function AddExerciseSheet({
  userId,
  day,
  mode,
  existingIds,
  nextPosition,
  allExercises,
  onChanged,
  onClose,
}: {
  userId: string;
  day: ProgramDay;
  mode: ProgramMode;
  existingIds: Set<string>;
  nextPosition: number;
  allExercises: Exercise[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Exercise["kind"]>("weighted");
  const [busy, setBusy] = useState(false);
  const available = allExercises.filter((e) => !existingIds.has(e.id));

  const createPe = async (ex: Exercise) => {
    const timed = ex.kind === "timed";
    const weighted = ex.kind === "weighted";
    await db.programExercises.add({
      id: newId(),
      programDayId: day.id,
      exerciseId: ex.id,
      position: nextPosition,
      sets: 3,
      targetReps: timed ? undefined : 5,
      targetSeconds: timed ? 30 : undefined,
      ...(mode === "progression" && weighted
        ? { workingWeightKg: 20, incrementKg: 2.5, deloadPct: 0.1, deloadAfterFails: 3 }
        : {}),
    });
  };

  const addExisting = async (ex: Exercise) => {
    if (busy) return;
    setBusy(true);
    await createPe(ex);
    onChanged();
    onClose();
  };

  const createNew = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    const ex: Exercise = {
      id: newId(),
      userId,
      name: name.trim(),
      kind,
      restSeconds: 90,
    };
    await db.exercises.add(ex);
    await createPe(ex);
    onChanged();
    onClose();
  };

  return (
    <Sheet label={`Add exercise to ${day.name}`} onClose={onClose}>
      <h2 className="disp mb-3 text-[19px]">Add to {day.name}</h2>

      {available.length > 0 && (
        <>
          <p className="eyebrow mb-1.5">From your exercises</p>
          <div className="mb-5 flex flex-col gap-1.5">
            {available.map((ex) => (
              <button
                key={ex.id}
                onClick={() => void addExisting(ex)}
                disabled={busy}
                className="flex items-center justify-between glass px-4 py-3 text-left disabled:opacity-60"
              >
                <span className="text-[14.5px]">{ex.name}</span>
                <span className="mono text-[12px] capitalize text-ink-faint">{ex.kind}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <p className="eyebrow mb-1.5">Create new</p>
      <input
        className={`${FIELD} mb-2`}
        autoComplete="off"
        autoCorrect="off"
        enterKeyHint="done"
        placeholder="Exercise name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void createNew()}
        data-selectable
      />
      <div className="mb-3 grid grid-cols-3 gap-2">
        {(["weighted", "bodyweight", "timed"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-xl border py-2 text-[12.5px] capitalize ${
              kind === k
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-ink-dim"
            }`}
          >
            {k}
          </button>
        ))}
      </div>
      <button
        onClick={() => void createNew()}
        disabled={busy || !name.trim()}
        className="w-full rounded-full bg-accent py-3.5 text-[15px] font-semibold text-on-accent disabled:opacity-50"
      >
        Add exercise
      </button>
    </Sheet>
  );
}

function NewDaySheet({
  suggested,
  onAdd,
  onClose,
}: {
  suggested: string;
  onAdd: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const add = () => {
    if (busy) return;
    setBusy(true);
    void onAdd(name.trim() || suggested).finally(() => setBusy(false));
  };

  return (
    <Sheet label="New day" onClose={onClose}>
      <h2 className="disp mb-3 text-[19px]">New day</h2>
      <input
        className={`${FIELD} mb-3`}
        autoComplete="off"
        enterKeyHint="done"
        maxLength={60}
        placeholder={suggested}
        aria-label="Day name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        data-selectable
      />
      <button
        onClick={add}
        disabled={busy}
        className="w-full rounded-full bg-accent py-3.5 text-[15px] font-semibold text-on-accent disabled:opacity-50"
      >
        Add day
      </button>
    </Sheet>
  );
}

function DaySheet({
  day,
  exerciseCount,
  canDelete,
  inProgress,
  onRename,
  onDelete,
  onClose,
}: {
  day: ProgramDay;
  exerciseCount: number;
  /** A routine keeps at least one day, and a day with a workout open stays. */
  canDelete: boolean;
  inProgress: boolean;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(day.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const done = async () => {
    if (name.trim() && name.trim() !== day.name) await onRename(name);
    onClose();
  };

  return (
    <Sheet label={`Edit day ${day.name}`} onClose={() => void done()}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="disp text-[19px]">Edit day</h2>
        <button onClick={() => void done()} className="-mr-2 px-3 py-2 text-[17px] font-semibold text-accent">
          Done
        </button>
      </div>
      <input
        className={FIELD}
        autoComplete="off"
        enterKeyHint="done"
        maxLength={60}
        aria-label="Day name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void done()}
        data-selectable
      />
      {inProgress ? (
        <p className="mt-2 px-1 text-[12px] text-ink-faint">
          This day has a workout in progress — finish or discard it to delete the day.
        </p>
      ) : (
        canDelete && (
          <p className="mt-2 px-1 text-[12px] text-ink-faint">
            {exerciseCount
              ? `Deleting it takes its ${exerciseCount} exercise${exerciseCount === 1 ? "" : "s"} out of the program. `
              : ""}
            Past workouts and their history stay as they were.
          </p>
        )
      )}
      {canDelete && (
        <button
          onClick={() => {
            if (confirmDelete) void onDelete();
            else setConfirmDelete(true);
          }}
          className={`mt-5 w-full rounded-full py-3.5 text-[15px] font-semibold ${
            confirmDelete ? "bg-plate-25 text-black" : "glass text-danger"
          }`}
        >
          {confirmDelete ? `Delete ${day.name} — tap to confirm` : "Delete day"}
        </button>
      )}
    </Sheet>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function fmtRest(s: number): string {
  if (s <= 0) return "off";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}:${String(r).padStart(2, "0")}` : `${m}:00`;
}
