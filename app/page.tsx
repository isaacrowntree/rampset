"use client";

import Link from "next/link";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import { useUser } from "@/state/UserContext";
import { AppHeader } from "@/components/AppHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  deloadPctForLayoff,
  applyLayoffDeload,
  deloadAckKey,
  layoffDeloadOffered,
} from "@/lib/deload";
import { getActiveWorkout } from "@/db/activeWorkout";
import type { ProgramDay, ProgramExercise, Exercise } from "@/lib/types";
import { loadColor } from "@/lib/plates";
import { LiftLoop, signatureLift } from "@/components/LiftLoop";
import { useGymPlates } from "@/lib/gymPlates";

export default function HomePage() {
  const { user } = useUser();
  // Immediate hide on tap — the localStorage ack isn't reactive, and the
  // apply may write nothing (no weight above the bar) to re-run the query.
  const [deloadTaken, setDeloadTaken] = useState(false);

  const data = useLiveQuery(async () => {
    if (!user) return null;
    const program = await db.programs.where({ userId: user.id }).first();
    if (!program) return null;
    const days = await db.programDays
      .where({ programId: program.id })
      .sortBy("position");
    const workouts = await db.workouts.where({ userId: user.id }).sortBy("date");
    const finished = workouts.filter((w) => w.endTs !== undefined);
    const last = finished[finished.length - 1];

    // An in-progress workout consumes its slot: "up next" starts after it.
    const active = await getActiveWorkout(user.id);
    const activeSetCount = active
      ? await db.sets.where({ workoutId: active.id }).count()
      : 0;

    let nextIdx = 0;
    const anchorDayId = active?.programDayId ?? last?.programDayId;
    if (anchorDayId) {
      const idx = days.findIndex((d) => d.id === anchorDayId);
      nextIdx = (idx + 1) % days.length;
    }
    const upcoming = Array.from({ length: Math.min(3, days.length) }, (_, i) => {
      return days[(nextIdx + i) % days.length];
    });

    const detail = new Map<string, { pe: ProgramExercise; ex: Exercise }[]>();
    for (const day of upcoming) {
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

    const daysSince = last
      ? Math.floor((Date.now() - Date.parse(last.date)) / 86_400_000)
      : null;

    // The layoff-deload offer is per-layoff: once taken (or a workout is
    // finished after it), it stays gone until the NEXT long gap.
    const deloadOffered = layoffDeloadOffered({
      daysSince,
      ackTs: Number(localStorage.getItem(deloadAckKey(user.id)) ?? 0),
      lastEndTs: last ? (last.endTs ?? Date.parse(last.date)) : 0,
    });

    return {
      program,
      upcoming,
      detail,
      daysSince,
      active,
      activeSetCount,
      deloadOffered,
      workoutCount: finished.length,

    };
  }, [user?.id]);

  if (!user || !data) return <PageSkeleton />;
  const { program, upcoming, detail, daysSince, active, activeSetCount, deloadOffered } =
    data;
  const isProgression = program.mode === "progression";

  return (
    <div>
      <AppHeader sub={today()} />

      {daysSince !== null &&
        deloadPctForLayoff(daysSince) > 0 &&
        isProgression &&
        deloadOffered &&
        !deloadTaken &&
        !active && (
        <div className="mb-4 flex items-center gap-3.5 glass p-4 ring-1 ring-plate-15/40">
          <p className="flex-1 text-[13.5px] leading-snug text-ink-dim">
            <strong className="font-semibold text-ink">
              {formatGap(daysSince)} since your last workout.
            </strong>{" "}
            Come back {Math.round(deloadPctForLayoff(daysSince) * 100)}% lighter to
            avoid soreness and rebuild fast.
          </p>
          <DeloadButton
            userId={user.id}
            pct={deloadPctForLayoff(daysSince)}
            onApplied={() => setDeloadTaken(true)}
          />
        </div>
      )}
      {daysSince !== null && daysSince >= 14 && !isProgression && (
        <div className="mb-4 glass p-4">
          <p className="text-[13.5px] leading-snug text-ink-dim">
            <strong className="font-semibold text-ink">Welcome back.</strong>{" "}
            Your last workout was {formatGap(daysSince)} ago — your numbers are saved.
          </p>
        </div>
      )}

      {active && (
        <>
          <p className="eyebrow mb-2.5 mt-5 flex items-center gap-1.5 px-4">
            <span className="h-1.5 w-1.5 rounded-full bg-plate-10 motion-safe:animate-pulse" aria-hidden />
            In progress
          </p>
          <Link
            href="/workout"
            className="glass row block p-4 ring-1 ring-accent/40"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="disp truncate text-[16px]">{active.dayLabel}</h2>
              <span className="mono flex-none text-xs text-ink-faint">
                {startedLabel(active.startTs)}
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between">
              <span className="text-[13.5px] text-ink-dim">
                {activeSetCount === 0
                  ? "No sets logged yet"
                  : `${activeSetCount} set${activeSetCount === 1 ? "" : "s"} logged`}
              </span>
              <span className="text-[15px] font-semibold text-accent">Resume</span>
            </div>
          </Link>
        </>
      )}

      {upcoming[0] && (
        <>
          <h2 className="eyebrow mb-2 mt-6 px-4">Next workout</h2>
          <NextCard
            day={upcoming[0]}
            rows={detail.get(upcoming[0].id) ?? []}
            startable={!active}
          />
        </>
      )}

      {upcoming.length > 1 && (
        <>
          <h2 className="eyebrow mb-2 mt-7 px-4">Coming up · {program.name}</h2>
          {/* Any day can be started, not just the suggested one — otherwise
              the only route to Workout B is finishing Workout A, which is what
              drives people to log a junk set just to move the program on.
              While a workout runs, rows go preview-only: tapping one would
              silently close out the in-progress workout. */}
          <div className="glass overflow-hidden">
            {upcoming.slice(1).map((day, i) => (
              <LaterRow
                key={`${day.id}-${i}`}
                day={day}
                rows={detail.get(day.id) ?? []}
                startable={!active}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The suggested next session, washed in its heaviest lift's plate color,
 * with a lifter looping the day's signature lift. */
function NextCard({
  day,
  rows,
  startable,
}: {
  day: ProgramDay;
  rows: { pe: ProgramExercise; ex: Exercise }[];
  startable: boolean;
}) {
  const heaviest = rows
    .filter(({ ex, pe }) => ex.kind === "weighted" && (pe.workingWeightKg ?? 0) >= 20)
    .sort((a, b) => (b.pe.workingWeightKg ?? 0) - (a.pe.workingWeightKg ?? 0))[0];
  const gymPlates = useGymPlates();
  const tone = loadColor(heaviest?.pe.workingWeightKg, 20, gymPlates);
  // The day's signature lift, looping — bench on A, deadlift on B — with
  // the bar wearing that lift's plate color.
  const kind = signatureLift(rows.map(({ ex }) => ex.name));
  const signature = rows.find(({ ex }) =>
    kind === "bench" ? /bench/i.test(ex.name) : kind === "deadlift" ? /deadlift/i.test(ex.name) : /squat/i.test(ex.name),
  );
  const discColor =
    loadColor(signature?.pe.workingWeightKg, 20, gymPlates)?.fill ?? "var(--accent)";
  return (
    <section
      className="glass relative overflow-hidden p-5"
      style={
        tone
          ? {
              backgroundImage: `radial-gradient(120% 70% at 85% -10%, color-mix(in srgb, ${tone.fill} 30%, transparent), transparent 65%)`,
            }
          : undefined
      }
    >
      <h3 className="large-title !text-[28px] !leading-[34px]">{day.name}</h3>
      <p className="mt-0.5 text-[15px] text-ink-dim">
        {rows.length} exercise{rows.length === 1 ? "" : "s"}
      </p>

      <div className="mt-3">
        <LiftLoop kind={kind} plateColor={discColor} />
      </div>


      <ul className="mt-3 divide-y divide-line">
        {rows.map(({ pe, ex }) => (
          <li key={pe.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 flex-none rounded-full"
                style={{ background: loadColor(pe.workingWeightKg, 20, gymPlates)?.fill ?? "var(--surface-3)" }}
              />
              <span className="truncate text-[16px]">{ex.name}</span>
            </span>
            <span className="flex flex-none items-center gap-2">
              <span className="mono text-[15px] text-ink-dim">{targetLabel(pe)}</span>
            </span>
          </li>
        ))}
      </ul>

      {startable && (
        <Link
          href={`/workout?day=${day.id}`}
          className="mt-4 block rounded-full bg-accent py-3.5 text-center text-[17px] font-semibold text-on-accent shadow-[0_8px_28px_-6px_var(--accent-glow)]"
        >
          Start {day.name}
        </Link>
      )}
    </section>
  );
}

/** A later day in the rotation, as an inset-grouped row. */
function LaterRow({
  day,
  rows,
  startable,
}: {
  day: ProgramDay;
  rows: { pe: ProgramExercise; ex: Exercise }[];
  startable: boolean;
}) {
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px]">{day.name}</span>
        <span className="block truncate text-[13px] text-ink-faint">
          {rows.map(({ ex }) => ex.name).join(", ")}
        </span>
      </span>
      {startable && (
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" className="flex-none text-ink-faint" aria-hidden>
          <path d="M1 1l6 6-6 6" />
        </svg>
      )}
    </>
  );
  const className =
    "row flex min-h-[60px] items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0";
  return startable ? (
    <Link href={`/workout?day=${day.id}`} className={className} aria-label={`Start ${day.name}`}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

function DeloadButton({
  userId,
  pct,
  onApplied,
}: {
  userId: string;
  pct: number;
  onApplied: () => void;
}) {
  const apply = async () => {
    onApplied();
    // Taken — hide the offer until the next layoff (also written when the
    // program isn't progression, so the banner never gets stuck).
    try {
      localStorage.setItem(deloadAckKey(userId), String(Date.now()));
    } catch {
      // private mode — the banner will just reappear
    }
    const program = await db.programs.where({ userId }).first();
    if (!program || program.mode !== "progression") return;
    const days = await db.programDays.where({ programId: program.id }).toArray();
    for (const day of days) {
      const pes = await db.programExercises.where({ programDayId: day.id }).toArray();
      for (const pe of pes) {
        if (pe.workingWeightKg === undefined) continue;
        const next = applyLayoffDeload(pe.workingWeightKg, pct);
        if (next !== pe.workingWeightKg) {
          await db.programExercises.update(pe.id, { workingWeightKg: next });
        }
      }
    }
  };
  return (
    <button
      onClick={apply}
      className="flex-none rounded-xl bg-plate-15 px-4 py-2.5 text-sm font-semibold text-black"
    >
      Deload −{Math.round(pct * 100)}%
    </button>
  );
}

function targetLabel(pe: ProgramExercise): string {
  if (pe.targetSeconds) return formatSeconds(pe.targetSeconds);
  const scheme = `${pe.sets}×${pe.targetReps ?? ""}`;
  if (pe.workingWeightKg !== undefined && pe.workingWeightKg !== 0) {
    return `${scheme} ${pe.workingWeightKg}kg`;
  }
  return scheme;
}

function formatSeconds(s: number): string {
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}:${String(rest).padStart(2, "0")}` : `${m}:00`;
}

function startedLabel(startTs?: number): string {
  if (!startTs) return "";
  const started = new Date(startTs);
  const time = started.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
  });
  return started.toDateString() === new Date().toDateString()
    ? `started ${time}`
    : `started ${started.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}`;
}

function today(): string {
  return new Date().toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatGap(days: number): string {
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}
