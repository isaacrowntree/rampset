"use client";

import Link from "next/link";
import { SwipeBack } from "@/components/SwipeBack";
import { useParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import { useUser } from "@/state/UserContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { fmtWeight } from "@/lib/weightDisplay";
import { summarizeTrend, deltaLabel } from "@/lib/progressTrend";
import { sessionSeries, type SessionMetrics } from "@/lib/progressStats";
import { personalBest } from "@/lib/records";
import type { ExerciseKind } from "@/lib/types";

interface MetricDef {
  key: keyof SessionMetrics;
  label: string;
  /** Delta chip unit passed to deltaLabel. */
  unit: string;
  format: (v: number) => string;
}

const KG = (v: number) => fmtWeight(Math.round(v * 10) / 10);
const VOL = (v: number) => `${Math.round(v).toLocaleString()}kg`;
const REPS = (v: number) => `${v}`;
const SECS = (v: number) =>
  v < 90 ? `${v}s` : `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;

const METRICS: Record<ExerciseKind, MetricDef[]> = {
  weighted: [
    { key: "weightTop", label: "Top set", unit: "kg", format: KG },
    { key: "e1rm", label: "Est. 1RM", unit: "kg", format: KG },
    { key: "volume", label: "Volume", unit: "kg", format: VOL },
    { key: "repsTotal", label: "Total reps", unit: "", format: REPS },
  ],
  bodyweight: [
    { key: "repsTop", label: "Best set", unit: "", format: REPS },
    { key: "repsTotal", label: "Total reps", unit: "", format: REPS },
  ],
  timed: [
    { key: "secondsTop", label: "Best hold", unit: "s", format: SECS },
    { key: "secondsTotal", label: "Total time", unit: "s", format: SECS },
  ],
};

function bestLabel(kind: ExerciseKind, value: number): string {
  if (kind === "timed") return SECS(value);
  if (kind === "bodyweight") return `${value} reps`;
  return KG(value);
}

export default function ExerciseProgressPage() {
  const { user } = useUser();
  const params = useParams<{ exerciseId: string }>();
  const exerciseId = params.exerciseId;

  const data = useLiveQuery(async () => {
    if (!user) return null;
    const exercise = await db.exercises.get(exerciseId);
    if (!exercise || exercise.userId !== user.id) return { missing: true as const };
    const sets = await db.sets
      .where({ userId: user.id, exerciseId })
      .filter((s) => !s.isWarmup && s.completedTs !== undefined)
      .toArray();
    return { exercise, series: sessionSeries(sets), best: personalBest(exercise.kind, sets) };
  }, [user?.id, exerciseId]);

  if (!user || !data) return <PageSkeleton title="Progress" />;

  if ("missing" in data) {
    return (
      <div>
        <DetailHeader name="Not found" />
        <p className="glass p-6 text-center text-sm text-ink-faint">
          That exercise isn’t in your log.
        </p>
      </div>
    );
  }

  const { exercise, series, best } = data;
  const metrics = METRICS[exercise.kind];

  return (
    <SwipeBack fallbackHref="/progress">
    <div className="pb-8">
      <DetailHeader name={exercise.name} />

      {series.length === 0 ? (
        <p className="glass p-6 text-center text-sm text-ink-faint">
          No logged sets yet.
        </p>
      ) : (
        <>
          <div className="glass mb-5 flex items-center justify-between p-4">
            <div>
              <div className="eyebrow mb-1">Personal best</div>
              <div className="disp flex items-center gap-1.5 text-[19px]">
                {best ? bestLabel(exercise.kind, best.value) : "—"}
                {best && <span className="text-[15px] text-plate-15">★</span>}
              </div>
              {best && (
                <div className="mono mt-0.5 text-[12px] text-ink-faint">
                  {formatDate(best.ts)}
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="disp text-[19px]">{series.length}</div>
              <div className="eyebrow mt-1">
                session{series.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {metrics.map((m) => (
              <MetricChart
                key={m.key}
                def={m}
                points={series.map((p) => p[m.key] as number)}
              />
            ))}
          </div>
        </>
      )}
    </div>
    </SwipeBack>
  );
}

function DetailHeader({ name }: { name: string }) {
  return (
    <>
    <header className="flex items-center pt-1">
      <Link
        href="/progress"
        aria-label="Back to Progress"
        className="row -ml-2 flex min-h-[44px] items-center gap-0.5 rounded-lg pr-2 text-[17px] text-accent"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Progress
      </Link>
    </header>
    <h1 className="large-title mb-4 truncate">{name}</h1>
    </>
  );
}

function MetricChart({ def, points }: { def: MetricDef; points: number[] }) {
  const summary = summarizeTrend(points);
  const delta = deltaLabel(summary, def.unit);
  const current = points.length ? points[points.length - 1] : 0;

  return (
    <div className="glass p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[13px] text-ink-dim">{def.label}</span>
        <span className="flex items-baseline gap-2">
          {delta && (
            <span
              className={`mono text-[11px] ${
                summary.delta > 0 ? "text-plate-10" : "text-ink-faint"
              }`}
            >
              {delta}
            </span>
          )}
          <span className="disp text-[16px]">{def.format(current)}</span>
        </span>
      </div>
      {summary.meaningful ? (
        <WideSparkline points={points} />
      ) : (
        <p className="mono py-3 text-center text-[11px] text-ink-faint">
          {summary.hasHistory ? "steady — no change to chart" : "one session so far"}
        </p>
      )}
    </div>
  );
}

/** Full-width line; uniform scaling keeps the endpoint dot round. */
function WideSparkline({ points }: { points: number[] }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const W = 300;
  const H = 56;
  const padX = 3;
  const padY = 6;
  const step = (W - padX * 2) / (points.length - 1);
  const x = (i: number) => padX + i * step;
  const y = (p: number) => H - padY - ((p - min) / range) * (H - padY * 2);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p).toFixed(1)}`)
    .join(" ");
  const last = points.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-hidden>
      <path
        d={path}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={x(last)} cy={y(points[last])} r="2.6" fill="var(--accent)" />
    </svg>
  );
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
