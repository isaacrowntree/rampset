"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import { useUser } from "@/state/UserContext";
import { AppHeader } from "@/components/AppHeader";
import { epley } from "@/lib/e1rm";
import type { SetEntry } from "@/lib/types";

interface ExerciseTrend {
  id: string;
  name: string;
  kind: string;
  current: string;
  points: number[];
  sessions: number;
}

export default function ProgressPage() {
  const { user } = useUser();

  const data = useLiveQuery(async () => {
    if (!user) return null;
    const exercises = await db.exercises.where({ userId: user.id }).toArray();
    const allSets = await db.sets.where({ userId: user.id }).toArray();
    const workSets = allSets.filter((s) => !s.isWarmup && s.completedTs);

    const byExercise = new Map<string, SetEntry[]>();
    for (const s of workSets) {
      const list = byExercise.get(s.exerciseId) ?? [];
      list.push(s);
      byExercise.set(s.exerciseId, list);
    }

    const trends: ExerciseTrend[] = [];
    for (const ex of exercises) {
      const sets = byExercise.get(ex.id);
      if (!sets || sets.length === 0) continue;

      // One point per workout: top-set weight (or best seconds / reps).
      const byWorkout = new Map<string, SetEntry[]>();
      for (const s of sets) {
        const list = byWorkout.get(s.workoutId) ?? [];
        list.push(s);
        byWorkout.set(s.workoutId, list);
      }
      const sessions = [...byWorkout.values()]
        .map((ss) => ({
          ts: Math.max(...ss.map((s) => s.completedTs ?? 0)),
          top: topValue(ss, ex.kind),
        }))
        .sort((a, b) => a.ts - b.ts);

      const points = sessions.map((s) => s.top).filter((v) => v !== 0);
      if (points.length === 0) continue;
      const last = sessions[sessions.length - 1];

      trends.push({
        id: ex.id,
        name: ex.name,
        kind: ex.kind,
        current: currentLabel(byWorkout, ex.kind),
        points: points.slice(-40),
        sessions: sessions.length,
      });
    }
    trends.sort((a, b) => b.sessions - a.sessions);

    // Big-three total for progression users.
    const big3 = ["Squat", "Bench press", "Deadlift"]
      .map((n) => trends.find((t) => t.name === n))
      .filter(Boolean) as ExerciseTrend[];
    const total =
      big3.length === 3
        ? big3.reduce((sum, t) => sum + (t.points[t.points.length - 1] ?? 0), 0)
        : null;

    // Body weight trend.
    const workouts = await db.workouts.where({ userId: user.id }).sortBy("date");
    const bw = workouts
      .filter((w) => w.bodyWeightKg)
      .map((w) => w.bodyWeightKg!) as number[];

    return { trends, total, bw };
  }, [user?.id]);

  if (!user || !data) return null;

  return (
    <div className="pb-8">
      <AppHeader title="Progress" sub={`${data.trends.length} exercises tracked`} />

      {data.total !== null && (
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3.5">
          <div>
            <div className="text-[15px] font-medium">Total</div>
            <div className="text-[12px] text-ink-faint">squat + bench + deadlift</div>
          </div>
          <div className="disp text-[22px]">
            {data.total}
            <span className="text-[13px] text-ink-dim">kg</span>
          </div>
        </div>
      )}

      {data.bw.length > 1 && (
        <Row
          name="Body weight"
          sub={`${data.bw[data.bw.length - 1]}kg`}
          points={data.bw.slice(-40)}
          color="var(--plate-15)"
        />
      )}

      <div className="divide-y divide-line">
        {data.trends.map((t) => (
          <Row
            key={t.id}
            name={t.name}
            sub={t.current}
            points={t.points}
            color="var(--accent)"
          />
        ))}
      </div>

      {data.trends.length === 0 && (
        <p className="rounded-2xl border border-line p-6 text-center text-sm text-ink-faint">
          Charts appear after your first workout — or import your history in Settings.
        </p>
      )}
    </div>
  );
}

function Row({
  name,
  sub,
  points,
  color,
}: {
  name: string;
  sub: string;
  points: number[];
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{name}</div>
        <div className="mono text-[12.5px] text-ink-faint">{sub}</div>
      </div>
      <Sparkline points={points} color={color} />
    </div>
  );
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) {
    return <span className="mono w-24 text-right text-[11px] text-ink-faint">1 session</span>;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 96;
  const h = 30;
  const step = w / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - 4 - ((p - min) / range) * (h - 8)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="flex-none" aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function topValue(sets: SetEntry[], kind: string): number {
  if (kind === "timed") return Math.max(...sets.map((s) => s.seconds ?? 0));
  if (kind === "bodyweight") return Math.max(...sets.map((s) => s.reps ?? 0));
  return Math.max(...sets.map((s) => s.weightKg ?? 0));
}

function currentLabel(byWorkout: Map<string, SetEntry[]>, kind: string): string {
  const sessions = [...byWorkout.values()].sort(
    (a, b) =>
      Math.max(...a.map((s) => s.completedTs ?? 0)) -
      Math.max(...b.map((s) => s.completedTs ?? 0)),
  );
  const last = sessions[sessions.length - 1];
  if (!last) return "";
  if (kind === "timed") {
    return `best hold ${Math.max(...last.map((s) => s.seconds ?? 0))}s`;
  }
  if (kind === "bodyweight") {
    return `× ${Math.max(...last.map((s) => s.reps ?? 0))}`;
  }
  const top = last.reduce((a, b) => ((a.weightKg ?? 0) >= (b.weightKg ?? 0) ? a : b));
  const w = top.weightKg ?? 0;
  const r = top.reps ?? 0;
  return r > 0 ? `${w}kg × ${r} · e1RM ${epley(w, r)}` : `${w}kg`;
}
