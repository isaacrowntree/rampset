"use client";

import { Chevron } from "@/components/Chevron";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import { useUser } from "@/state/UserContext";
import { AppHeader } from "@/components/AppHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { getActiveWorkout } from "@/db/activeWorkout";
import { takeJustFinished, type JustFinished } from "@/lib/justFinished";
import { Sheet } from "@/components/Sheet";
import { Celebration } from "@/components/Celebration";
import { scheduleBackup } from "@/lib/backupAfterEdit";
import { roundStep } from "@/lib/weightDisplay";
import { prWorkoutIds } from "@/lib/records";
import { orderExercises } from "@/lib/exerciseOrder";
import type { SetEntry } from "@/lib/types";

/** exerciseId → program position for a workout's day, so History lists
 * exercises in the same order the workout screen does. */
async function exercisePositions(programDayId?: string): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (!programDayId) return m;
  const pes = await db.programExercises.where({ programDayId }).toArray();
  for (const pe of pes) m.set(pe.exerciseId, pe.position);
  return m;
}

export default function HistoryPage() {
  const { user } = useUser();

  // Which past workout is open for editing its logged sets.
  const [editingId, setEditingId] = useState<string | null>(null);
  // A read-only summary sheet, for a day tapped in the calendar that isn't
  // in the loaded Recent list.
  const [summaryId, setSummaryId] = useState<string | null>(null);
  // Recent list grows on scroll; a calendar tap briefly flashes its card.
  const [limit, setLimit] = useState(20);
  const [flashId, setFlashId] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // One-shot congrats handoff from the workout screen (external system:
  // sessionStorage — read once, then it's consumed). The ref guard stops
  // React's dev double-invoke (and any remount) from consuming the flag on
  // the first run and then clearing the banner to null on the second.
  const [celebrate, setCelebrate] = useState<JustFinished | null>(null);
  const readCelebrate = useRef(false);
  useEffect(() => {
    if (readCelebrate.current) return;
    readCelebrate.current = true;
    setCelebrate(takeJustFinished());
  }, []);

  const data = useLiveQuery(async () => {
    if (!user) return null;
    const workouts = await db.workouts.where({ userId: user.id }).sortBy("date");
    const finished = workouts.filter((w) => w.endTs !== undefined).reverse();
    const recent = finished.slice(0, limit);
    const setsByWorkout = new Map<string, SetEntry[]>();
    for (const w of recent) {
      setsByWorkout.set(w.id, await db.sets.where({ workoutId: w.id }).toArray());
    }
    const active = await getActiveWorkout(user.id);
    const activeSets = active
      ? await db.sets.where({ workoutId: active.id }).toArray()
      : [];
    // Program-position order per day, so each card lists exercises the way the
    // workout screen does rather than by exercise id.
    const dayIds = new Set(
      [...recent, active].flatMap((w) => (w?.programDayId ? [w.programDayId] : [])),
    );
    const positionsByDay = new Map<string, Map<string, number>>();
    for (const dayId of dayIds) {
      positionsByDay.set(dayId, await exercisePositions(dayId));
    }
    const exercises = await db.exercises.where({ userId: user.id }).toArray();
    const exName = new Map(exercises.map((e) => [e.id, e.name]));
    const trainedDates = new Set(finished.map((w) => w.date));

    // PR workouts: any session that set a new all-time best for any exercise.
    // Computed over ALL sets (a PR is relative to full history, not the
    // loaded page).
    const allSets = await db.sets.where({ userId: user.id }).toArray();
    const setsByExercise = new Map<string, SetEntry[]>();
    for (const s of allSets) {
      const arr = setsByExercise.get(s.exerciseId) ?? [];
      arr.push(s);
      setsByExercise.set(s.exerciseId, arr);
    }
    const prWorkouts = new Set<string>();
    for (const ex of exercises) {
      for (const id of prWorkoutIds(ex.kind, setsByExercise.get(ex.id) ?? [])) {
        prWorkouts.add(id);
      }
    }
    return {
      finished,
      recent,
      setsByWorkout,
      positionsByDay,
      exName,
      trainedDates,
      prWorkouts,
      active,
      activeSets,
    };
  }, [user?.id, limit]);

  // Grow the Recent list as its sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setLimit((l) => l + 20);
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [data?.recent.length]);

  const scrollToWorkout = (id: string) => {
    const el = document.getElementById(`wk-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(id);
    setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1600);
  };

  if (!user || !data) return <PageSkeleton title="History" />;

  return (
    <div className="pb-6">
      <AppHeader title="History" sub={`${data.finished.length.toLocaleString()} workouts`} />
      {celebrate && (
        <Celebration
          tonnageKg={celebrate.tonnageKg}
          workouts={data.finished.length}
          pr={data.prWorkouts.has(celebrate.workoutId)}
        />
      )}
      <Calendar
        trainedDates={data.trainedDates}
        onPickDate={(date) => {
          // finished is newest-first, so the first match is the latest
          // workout on that day.
          const w = data.finished.find((f) => f.date === date);
          if (!w) return;
          // Loaded in Recent → scroll to it; otherwise show a summary sheet.
          if (data.recent.some((r) => r.id === w.id)) scrollToWorkout(w.id);
          else setSummaryId(w.id);
        }}
      />
      <p className="eyebrow mb-2.5 mt-6 px-4">Recent</p>
      <div className="flex flex-col gap-3">
        {data.active && (
          <Link href="/workout" className="glass row block p-4 ring-1 ring-accent/40">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="disp truncate text-[15.5px]">{data.active.dayLabel}</h2>
              <span className="mono flex flex-none items-center gap-1.5 text-xs text-plate-10">
                <span className="h-1.5 w-1.5 rounded-full bg-plate-10 motion-safe:animate-pulse" aria-hidden />
                in progress
              </span>
            </div>
            {orderExercises(
              groupByExercise(data.activeSets),
              (data.active.programDayId && data.positionsByDay.get(data.active.programDayId)) ||
                new Map(),
            ).map(([exId, exSets]) => (
              <div key={exId} className="flex items-baseline justify-between py-1">
                <span className="text-[14px]">{data.exName.get(exId) ?? "Unknown"}</span>
                <span className="mono text-[12.5px] text-ink-dim">{summarize(exSets)}</span>
              </div>
            ))}
            <div className="mt-1.5 border-t border-line pt-2 text-[12.5px] font-semibold text-accent">
              Resume
            </div>
          </Link>
        )}
        {data.recent.map((w) => {
          const byExercise = orderExercises(
            groupByExercise(data.setsByWorkout.get(w.id) ?? []),
            (w.programDayId && data.positionsByDay.get(w.programDayId)) || new Map(),
          );
          const duration =
            w.endTs && w.startTs ? Math.round((w.endTs - w.startTs) / 60000) : null;
          return (
            <button
              key={w.id}
              id={`wk-${w.id}`}
              onClick={() => setEditingId(w.id)}
              aria-label={`Edit ${w.dayLabel} from ${formatDate(w.date)}`}
              className={`glass row block w-full p-4 text-left ${
                flashId === w.id ? "ring-2 ring-accent" : ""
              }`}
            >
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="disp flex min-w-0 items-baseline gap-1.5 truncate text-[15.5px]">
                  <span className="truncate">{w.dayLabel}</span>
                  {data.prWorkouts.has(w.id) && (
                    <span
                      className="flex-none text-[13px] text-plate-15"
                      title="Personal record"
                      aria-label="Personal record"
                    >
                      ★
                    </span>
                  )}
                </h2>
                <span className="mono flex-none text-xs text-ink-faint">
                  {formatDate(w.date)}
                </span>
              </div>
              {byExercise.map(([exId, exSets]) => (
                <div key={exId} className="flex items-baseline justify-between py-1">
                  <span className="text-[14px]">{data.exName.get(exId) ?? "Unknown"}</span>
                  <span className="mono text-[12.5px] text-ink-dim">
                    {summarize(exSets)}
                  </span>
                </div>
              ))}
              {(w.notes || duration !== null) && (
                <div className="mt-1.5 flex justify-between border-t border-line pt-2 text-[12.5px] text-ink-faint">
                  <span className="truncate italic">{w.notes ?? ""}</span>
                  {duration !== null && duration > 0 && <span>{duration} min</span>}
                </div>
              )}
            </button>
          );
        })}
        {data.recent.length === 0 && !data.active && (
          <p className="glass p-6 text-center text-sm text-ink-faint">
            No workouts yet. Start one from Home.
          </p>
        )}
        {data.recent.length < data.finished.length && (
          <div ref={sentinelRef} aria-hidden className="h-6" />
        )}
      </div>

      {summaryId && (() => {
        const w = data.finished.find((r) => r.id === summaryId);
        if (!w) return null;
        return (
          <WorkoutSummarySheet
            workoutId={w.id}
            title={w.dayLabel}
            date={formatDate(w.date)}
            exName={data.exName}
            onEdit={() => {
              setSummaryId(null);
              setEditingId(w.id);
            }}
            onClose={() => setSummaryId(null)}
          />
        );
      })()}

      {editingId && (() => {
        const w = data.finished.find((r) => r.id === editingId);
        if (!w) return null;
        return (
          <EditWorkoutSheet
            workoutId={w.id}
            canReopen={w.programDayId !== undefined}
            title={w.dayLabel}
            date={formatDate(w.date)}
            exName={data.exName}
            onSaved={() => scheduleBackup(user.id, user.email)}
            onClose={() => setEditingId(null)}
          />
        );
      })()}
    </div>
  );
}

/** Read-only recap of a workout — the "recent card" as a sheet, for a
 * calendar day that isn't in the loaded Recent list. Edit is a step in. */
function WorkoutSummarySheet({
  workoutId,
  title,
  date,
  exName,
  onEdit,
  onClose,
}: {
  workoutId: string;
  title: string;
  date: string;
  exName: Map<string, string>;
  onEdit: () => void;
  onClose: () => void;
}) {
  const loaded = useLiveQuery(async () => {
    const sets = await db.sets.where({ workoutId }).toArray();
    const w = await db.workouts.get(workoutId);
    return { sets, positions: await exercisePositions(w?.programDayId) };
  }, [workoutId]);
  const sets = loaded?.sets ?? [];
  const byExercise = orderExercises(groupByExercise(sets), loaded?.positions ?? new Map());

  return (
    <Sheet label={`${title} recap`} onClose={onClose}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="disp text-[19px]">{title}</h2>
        <span className="mono text-xs text-ink-faint">{date}</span>
      </div>
      <div className="glass p-4">
        {byExercise.map(([exId, exSets]) => (
          <div key={exId} className="flex items-baseline justify-between py-1">
            <span className="text-[14px]">{exName.get(exId) ?? "Unknown"}</span>
            <span className="mono text-[12.5px] text-ink-dim">{summarize(exSets)}</span>
          </div>
        ))}
        {sets.length === 0 && <p className="text-sm text-ink-faint">Loading…</p>}
      </div>
      <button
        onClick={onEdit}
        className="mt-4 w-full rounded-full bg-accent py-3.5 text-[15px] font-semibold text-on-accent"
      >
        Edit workout
      </button>
    </Sheet>
  );
}

/** Edit a finished workout's logged sets — correct a weight or rep count
 * after the fact (e.g. Dips logged at 2.5kg was actually −10kg assisted). */
function EditWorkoutSheet({
  workoutId,
  canReopen,
  title,
  date,
  exName,
  onSaved,
  onClose,
}: {
  workoutId: string;
  /** Has a program day to rebuild the full workout screen from. */
  canReopen: boolean;
  title: string;
  date: string;
  exName: Map<string, string>;
  onSaved: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  // Set before leaving for the workout view, so the sheet doesn't pop the
  // history entry router.replace just took over (that bounced straight back).
  const navigatingAway = useRef(false);

  // Self-loading by id so any workout opens — including old ones a calendar
  // tap reaches that aren't in the recent list.
  const loaded = useLiveQuery(async () => {
    const rows = await db.sets.where({ workoutId }).toArray();
    const w = await db.workouts.get(workoutId);
    return { sets: rows, positions: await exercisePositions(w?.programDayId) };
  }, [workoutId]);
  const sets = useMemo(() => loaded?.sets ?? [], [loaded]);
  const groups = orderExercises(groupForEdit(sets), loaded?.positions ?? new Map());

  type Row = { weight: string; reps: string; seconds: string };
  const [draft, setDraft] = useState<Record<string, Row>>({});
  // Assist is per exercise: a negative weight means the machine took load off.
  const [assisted, setAssisted] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  // Seed the draft once the sets arrive (liveQuery is async); the guard keeps
  // later live updates from clobbering in-progress edits.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || sets.length === 0) return;
    seeded.current = true;
    const d: Record<string, Row> = {};
    const a: Record<string, boolean> = {};
    for (const s of sets) {
      d[s.id] = {
        weight: s.weightKg != null ? String(Math.abs(s.weightKg)) : "",
        reps: s.reps != null ? String(s.reps) : "",
        seconds: s.seconds != null ? String(s.seconds) : "",
      };
      if ((s.weightKg ?? 0) < 0) a[s.exerciseId] = true;
    }
    setDraft(d);
    setAssisted(a);
  }, [sets]);

  const setField = (id: string, key: keyof Row, val: string) =>
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], [key]: val } }));

  // Nudge a stored magnitude by ±2.5kg (the assist toggle owns the sign),
  // never below zero.
  const stepWeight = (id: string, dir: -1 | 1) => {
    if (typeof navigator !== "undefined") navigator.vibrate?.(8);
    setDraft((prev) => {
      const cur = Number(prev[id]?.weight ?? "0") || 0;
      const next = Math.max(0, roundStep(cur + dir * 2.5));
      return { ...prev, [id]: { ...prev[id], weight: String(next) } };
    });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    for (const s of sets) {
      const row = draft[s.id];
      if (!row) continue;
      const changes: Partial<SetEntry> = {};
      if (s.seconds != null) {
        if (row.seconds !== "" && Number.isFinite(Number(row.seconds))) {
          changes.seconds = Number(row.seconds);
        }
      } else {
        if (row.weight !== "" && Number.isFinite(Number(row.weight))) {
          const mag = Math.abs(Number(row.weight));
          changes.weightKg = assisted[s.exerciseId] ? -mag : mag;
        }
        if (row.reps !== "" && Number.isFinite(Number(row.reps))) {
          changes.reps = Number(row.reps);
        }
      }
      if (Object.keys(changes).length > 0) await db.sets.update(s.id, changes);
    }
    onSaved();
    onClose();
  };

  return (
    <Sheet label={`Edit ${title}`} onClose={onClose} keepHistoryOnUnmount={navigatingAway}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="disp text-[19px]">{title}</h2>
        <span className="mono text-xs text-ink-faint">{date}</span>
      </div>
      {canReopen && (
        // The sheet only corrects logged sets; the workout screen can add the
        // ones that were never logged (a workout finished too early).
        <button
          onClick={() => {
            navigatingAway.current = true;
            router.replace(`/workout?edit=${workoutId}`);
          }}
          className="glass row mb-4 flex min-h-[44px] w-full items-center justify-between px-4 py-3 text-left text-[17px] text-accent"
        >
          Edit in workout
          <Chevron />
        </button>
      )}

      {groups.map(([exId, exSets]) => {
        const timed = exSets.some((s) => s.seconds != null);
        return (
          <section key={exId} className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold">{exName.get(exId) ?? "Unknown"}</h3>
              {!timed && (
                <button
                  aria-pressed={!!assisted[exId]}
                  aria-label={`${exName.get(exId) ?? "Exercise"}: assisted (weight is subtracted)`}
                  onClick={() => setAssisted((p) => ({ ...p, [exId]: !p[exId] }))}
                  className={`min-h-[30px] rounded-full px-3 text-[13px] font-medium ${
                    assisted[exId] ? "bg-accent-soft text-accent" : "bg-fill text-ink-dim"
                  }`}
                >
                  Assisted
                </button>
              )}
            </div>
            <div className="divide-y divide-line/60">
              {exSets.map((s, i) => (
                <div
                  key={s.id}
                  className="grid grid-cols-[26px_1fr_1fr] items-center gap-3 py-2"
                >
                  <span className="disp text-[13px] text-ink-dim">
                    {s.isWarmup ? "W" : i + 1}
                  </span>
                  {timed ? (
                    <label className="col-span-2 flex items-center gap-2">
                      <input
                        className="setfield"
                        type="number"
                        inputMode="numeric"
                        aria-label={`Set ${i + 1} seconds`}
                        value={draft[s.id]?.seconds ?? ""}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setField(s.id, "seconds", e.target.value)}
                      />
                      <span className="text-[12px] text-ink-faint">sec</span>
                    </label>
                  ) : (
                    <>
                      <div className="flex items-center gap-1">
                        <StepButton
                          dir={-1}
                          label={`Set ${i + 1} weight down`}
                          onClick={() => stepWeight(s.id, -1)}
                        />
                        <span className="relative flex-1">
                          {assisted[exId] && (
                            <span
                              aria-hidden
                              className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint"
                            >
                              −
                            </span>
                          )}
                          <input
                            className={`setfield ${assisted[exId] ? "pl-4" : ""}`}
                            type="number"
                            inputMode="decimal"
                            step="0.5"
                            aria-label={`Set ${i + 1} weight in kg`}
                            value={draft[s.id]?.weight ?? ""}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => setField(s.id, "weight", e.target.value)}
                          />
                        </span>
                        <StepButton
                          dir={1}
                          label={`Set ${i + 1} weight up`}
                          onClick={() => stepWeight(s.id, 1)}
                        />
                      </div>
                      <label className="flex items-center gap-1.5">
                        <input
                          className="setfield"
                          type="number"
                          inputMode="numeric"
                          aria-label={`Set ${i + 1} reps`}
                          value={draft[s.id]?.reps ?? ""}
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => setField(s.id, "reps", e.target.value)}
                        />
                        <span className="text-[12px] text-ink-faint">reps</span>
                      </label>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <div className="mt-4 flex gap-2.5">
        <button
          onClick={onClose}
          className="glass flex-1 rounded-full py-3.5 text-[15px] font-medium text-ink"
        >
          Cancel
        </button>
        <button
          onClick={() => void save()}
          disabled={saving}
          className="flex-1 rounded-full bg-accent py-3.5 text-[15px] font-semibold text-on-accent disabled:opacity-60"
        >
          Save changes
        </button>
      </div>
    </Sheet>
  );
}

function StepButton({
  dir,
  label,
  onClick,
}: {
  dir: -1 | 1;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-8 flex-none items-center justify-center rounded-lg border border-line bg-surface-2 text-[18px] text-ink"
    >
      {dir === -1 ? "−" : "+"}
    </button>
  );
}

/** Group a workout's sets by exercise (first-seen order), each exercise's
 * sets ordered by set index, warmups included. */
function groupForEdit(sets: SetEntry[]): Map<string, SetEntry[]> {
  const m = new Map<string, SetEntry[]>();
  for (const s of sets) {
    const list = m.get(s.exerciseId) ?? [];
    list.push(s);
    m.set(s.exerciseId, list);
  }
  for (const list of m.values()) list.sort((a, b) => a.setIndex - b.setIndex);
  return m;
}

function Calendar({
  trainedDates,
  onPickDate,
}: {
  trainedDates: Set<string>;
  onPickDate: (date: string) => void;
}) {
  const now = new Date();
  const todayStr = isoDate(now.getFullYear(), now.getMonth(), now.getDate());

  // The visible month, offset from the current one. 0 = this month.
  const [monthOffset, setMonthOffset] = useState(0);
  const view = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = view.getFullYear();
  const month = view.getMonth();
  const startDow = (view.getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const atCurrentMonth = monthOffset >= 0;
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;

  const go = (dir: -1 | 1) => {
    setMonthOffset((o) => (dir === 1 ? Math.min(0, o + 1) : o - 1));
    if (typeof navigator !== "undefined") navigator.vibrate?.(8);
  };

  // Horizontal swipe pages months; ignore mostly-vertical drags (scrolling).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: ReactTouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: ReactTouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0 && !atCurrentMonth) go(1); // swipe left → forward
    else if (dx > 0) go(-1); // swipe right → back
  };

  let trainedThisMonth = 0;
  for (const d of trainedDates) if (d.startsWith(monthPrefix) && d <= todayStr) trainedThisMonth++;

  const cells: Array<{ day: number; date: string } | null> = [
    ...Array.from({ length: startDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      date: isoDate(year, month, i + 1),
    })),
  ];

  return (
    <div className="glass p-4" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="mb-2 flex items-center justify-between">
        <button
          aria-label="Previous month"
          onClick={() => go(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-dim active:bg-fill"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <h2 className="disp text-[15.5px]">
          {view.toLocaleDateString("en-AU", { month: "long", year: "numeric" })}
        </h2>
        <button
          aria-label="Next month"
          onClick={() => go(1)}
          disabled={atCurrentMonth}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-dim active:bg-fill disabled:opacity-30"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div
        key={monthOffset}
        className="mono grid grid-cols-7 gap-1 text-center text-[12px] motion-safe:animate-[sheet-backdrop_180ms_ease]"
      >
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="py-1 text-[11px] font-semibold text-ink-faint">
            {d}
          </span>
        ))}
        {cells.map((c, i) => {
          if (c === null) return <span key={i} />;
          const isToday = c.date === todayStr;
          const isFuture = c.date > todayStr;
          const trained = trainedDates.has(c.date) && !isFuture;
          const cellClass = `flex flex-col items-center gap-0.5 rounded-lg py-1 ${
            isToday ? "bg-accent font-semibold text-on-accent" : isFuture ? "text-ink-faint/40" : "text-ink"
          }`;
          const dot = (
            <span
              aria-hidden
              className={`h-1 w-1 rounded-full ${
                trained
                  ? isToday
                    ? "bg-white"
                    : "bg-plate-10 shadow-[0_0_5px_1px_rgba(52,201,121,0.6)]"
                  : "bg-transparent"
              }`}
            />
          );
          // Trained days are tappable — open that day's workout.
          return trained ? (
            <button
              key={i}
              onClick={() => onPickDate(c.date)}
              aria-label={`Open workout on ${c.date}`}
              className={`${cellClass} active:opacity-70`}
            >
              {c.day}
              {dot}
            </button>
          ) : (
            <span key={i} className={cellClass}>
              {c.day}
              {dot}
            </span>
          );
        })}
      </div>
      <p className="mt-3 border-t border-line pt-2 text-center text-[12px] text-ink-faint">
        {trainedThisMonth === 0
          ? "No workouts this month"
          : `${trainedThisMonth} workout${trainedThisMonth === 1 ? "" : "s"} this month`}
      </p>
    </div>
  );
}

/** Local-calendar ISO date (yyyy-mm-dd), matching how workout dates are stored. */
function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function groupByExercise(sets: SetEntry[]): Map<string, SetEntry[]> {
  const byExercise = new Map<string, SetEntry[]>();
  for (const s of sets) {
    if (s.isWarmup) continue;
    const list = byExercise.get(s.exerciseId) ?? [];
    list.push(s);
    byExercise.set(s.exerciseId, list);
  }
  return byExercise;
}

function summarize(sets: SetEntry[]): string {
  if (sets.length === 0) return "—";
  const first = sets[0];
  if (first.seconds) return `${sets.length} × ${first.seconds}s`;
  const weights = new Set(sets.map((s) => s.weightKg ?? 0));
  const reps = new Set(sets.map((s) => s.reps ?? 0));
  const w = first.weightKg;
  const scheme =
    reps.size === 1 ? `${sets.length}×${first.reps}` : `${sets.length} sets`;
  if (w !== undefined && w !== 0 && weights.size === 1) return `${scheme} ${w}kg`;
  return scheme;
}

function formatDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
