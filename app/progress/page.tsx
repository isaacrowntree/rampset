"use client";

import { Chevron } from "@/components/Chevron";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import { useUser } from "@/state/UserContext";
import { AppHeader } from "@/components/AppHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { epley } from "@/lib/e1rm";
import { summarizeTrend, deltaLabel } from "@/lib/progressTrend";
import { isNewPR } from "@/lib/records";
import type { SetEntry } from "@/lib/types";

interface ExerciseTrend {
  id: string;
  name: string;
  kind: string;
  current: string;
  points: number[];
  sessions: number;
  isPR: boolean;
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

      trends.push({
        id: ex.id,
        name: ex.name,
        kind: ex.kind,
        current: currentLabel(byWorkout, ex.kind),
        points: points.slice(-40),
        sessions: sessions.length,
        isPR: isNewPR(ex.kind, sets),
      });
    }
    trends.sort((a, b) => b.sessions - a.sessions);

    // Body weight trend.
    const workouts = await db.workouts.where({ userId: user.id }).sortBy("date");
    const bw = workouts
      .filter((w) => w.bodyWeightKg)
      .map((w) => w.bodyWeightKg!) as number[];

    return { trends, bw };
  }, [user?.id]);

  if (!user || !data) return <PageSkeleton title="Progress" />;

  return (
    <div className="pb-8">
      <AppHeader title="Progress" sub={`${data.trends.length} exercises tracked`} />

      {(data.bw.length > 1 || data.trends.length > 0) && (
      <div className="glass divide-y divide-line overflow-hidden">
      {data.bw.length > 1 && (
        <Row
          name="Body weight"
          sub={`${data.bw[data.bw.length - 1]}kg`}
          points={data.bw.slice(-40)}
          color="var(--plate-15)"
          unit="kg"
        />
      )}

        {data.trends.map((t) => (
          <Link
            key={t.id}
            href={`/progress/${t.id}`}
            className="row block"
          >
            <Row
              name={t.name}
              sub={t.current}
              points={t.points}
              color="var(--accent)"
              unit={t.kind === "timed" ? "s" : t.kind === "bodyweight" ? "" : "kg"}
              isPR={t.isPR}
              chevron
            />
          </Link>
        ))}
      </div>
      )}

      {data.trends.length === 0 && (
        <p className="glass p-6 text-center text-sm text-ink-faint">
          Charts appear after your first workout.
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
  unit,
  isPR = false,
  chevron = false,
}: {
  name: string;
  sub: string;
  points: number[];
  color: string;
  unit: string;
  isPR?: boolean;
  chevron?: boolean;
}) {
  // A flat or single-session series has no line to draw — show a word, not a
  // dead-straight stroke that reads as a broken chart.
  const summary = summarizeTrend(points);
  const delta = deltaLabel(summary, unit);

  return (
    <div className="flex min-h-[44px] items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[17px]">
          <span className="truncate">{name}</span>
          {isPR && (
            <span
              className="flex-none text-[12px] text-plate-15"
              title="New personal record"
              aria-label="New personal record"
            >
              ★
            </span>
          )}
        </div>
        <div className="mono text-[13px] text-ink-faint">{sub}</div>
      </div>
      {summary.meaningful ? (
        <div className="flex flex-none items-center gap-2.5">
          {delta && (
            <span
              className={`mono text-[13px] ${
                summary.delta > 0 ? "text-success" : "text-ink-faint"
              }`}
            >
              {delta}
            </span>
          )}
          <Sparkline points={points} color={color} />
        </div>
      ) : (
        <span className="flex-none text-right text-[13px] text-ink-faint">
          {summary.hasHistory ? "No change" : "1 workout"}
        </span>
      )}
      {chevron && <Chevron />}
    </div>
  );
}

/** Callers only mount this for a moving series (summarizeTrend().meaningful),
 * so there is always a visible slope and a min ≠ max. */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 96;
  const h = 30;
  const padX = 3;
  const padY = 4;
  const step = (w - padX * 2) / (points.length - 1);
  const x = (i: number) => padX + i * step;
  const y = (p: number) => h - padY - ((p - min) / range) * (h - padY * 2);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p).toFixed(1)}`)
    .join(" ");
  const last = points.length - 1;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="flex-none" aria-hidden>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Endpoint marker: anchors the eye at "where you are now". */}
      <circle cx={x(last)} cy={y(points[last])} r="2.3" fill={color} />
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
  // An estimated 1RM means nothing for an assisted (negative) lift.
  return r > 0 && w > 0 ? `${w}kg × ${r} · est. 1RM ${epley(w, r)}` : r > 0 ? `${w}kg × ${r}` : `${w}kg`;
}
