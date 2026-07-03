"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import { useUser } from "@/state/UserContext";
import { AppHeader } from "@/components/AppHeader";
import type { SetEntry } from "@/lib/types";

export default function HistoryPage() {
  const { user } = useUser();

  const data = useLiveQuery(async () => {
    if (!user) return null;
    const workouts = await db.workouts.where({ userId: user.id }).sortBy("date");
    const finished = workouts.filter((w) => w.endTs !== undefined).reverse();
    const recent = finished.slice(0, 20);
    const setsByWorkout = new Map<string, SetEntry[]>();
    for (const w of recent) {
      setsByWorkout.set(w.id, await db.sets.where({ workoutId: w.id }).toArray());
    }
    const exercises = await db.exercises.where({ userId: user.id }).toArray();
    const exName = new Map(exercises.map((e) => [e.id, e.name]));
    const trainedDates = new Set(finished.map((w) => w.date));
    return { finished, recent, setsByWorkout, exName, trainedDates };
  }, [user?.id]);

  if (!user || !data) return null;

  return (
    <div className="pb-6">
      <AppHeader title="History" sub={`${data.finished.length.toLocaleString()} workouts`} />
      <Calendar trainedDates={data.trainedDates} />
      <p className="eyebrow mb-2.5 mt-6 px-1">Recent</p>
      <div className="flex flex-col gap-3">
        {data.recent.map((w) => {
          const sets = (data.setsByWorkout.get(w.id) ?? []).filter((s) => !s.isWarmup);
          const byExercise = new Map<string, SetEntry[]>();
          for (const s of sets) {
            const list = byExercise.get(s.exerciseId) ?? [];
            list.push(s);
            byExercise.set(s.exerciseId, list);
          }
          const duration =
            w.endTs && w.startTs ? Math.round((w.endTs - w.startTs) / 60000) : null;
          return (
            <article key={w.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="disp truncate text-[15.5px]">{w.dayLabel}</h2>
                <span className="mono flex-none text-xs text-ink-faint">
                  {formatDate(w.date)}
                </span>
              </div>
              {[...byExercise.entries()].map(([exId, exSets]) => (
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
            </article>
          );
        })}
        {data.recent.length === 0 && (
          <p className="rounded-2xl border border-line p-6 text-center text-sm text-ink-faint">
            No workouts yet. Start one from Home, or import your history in Settings.
          </p>
        )}
      </div>
    </div>
  );
}

function Calendar({ trainedDates }: { trainedDates: Set<string> }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = now.toISOString().slice(0, 10);

  const cells: Array<{ day: number; date: string } | null> = [
    ...Array.from({ length: startDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      return { day: d, date };
    }),
  ];

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="disp mb-2 text-[15.5px]">
        {now.toLocaleDateString("en-AU", { month: "long", year: "numeric" })}
      </h2>
      <div className="mono grid grid-cols-7 gap-1 text-center text-[12px]">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="py-1 text-[10px] tracking-widest text-ink-faint">
            {d}
          </span>
        ))}
        {cells.map((c, i) =>
          c === null ? (
            <span key={i} />
          ) : (
            <span
              key={i}
              className={`rounded-lg py-1.5 ${
                c.date === todayStr
                  ? "bg-accent font-semibold text-white"
                  : trainedDates.has(c.date)
                    ? "text-ink shadow-[inset_0_0_0_1.5px_var(--plate-10)]"
                    : "text-ink-dim"
              }`}
            >
              {c.day}
            </span>
          ),
        )}
      </div>
    </div>
  );
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
