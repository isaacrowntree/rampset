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
        <div className="mb-4 flex items-center gap-3.5 glass border-plate-15/40 p-4">
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
            Last session was {formatGap(daysSince)} ago — your numbers are saved.
          </p>
        </div>
      )}

      {active && (
        <>
          <p className="eyebrow mb-2.5 mt-5 flex items-center gap-1.5 px-1">
            <span className="h-1.5 w-1.5 rounded-full bg-plate-10 motion-safe:animate-pulse" aria-hidden />
            In progress
          </p>
          <Link
            href="/workout"
            className="glass block border-accent/40 p-4 transition-colors active:border-accent"
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
              <span className="text-[13.5px] font-semibold text-accent">Resume →</span>
            </div>
          </Link>
        </>
      )}

      <p className="eyebrow mb-2.5 mt-5 px-1">
        Up next · {program.name}
        <span className="mono ml-2 rounded-full border border-line px-2 py-0.5 text-[10px] normal-case tracking-normal text-ink-dim">
          {program.mode === "progression" ? "program" : program.mode === "madcow" ? "madcow" : "routine"}
        </span>
      </p>

      {/* Room for the floating CTA + dock so the last card can scroll clear. */}
      <div className="flex flex-col gap-3 pb-44">
        {upcoming.map((day, i) => (
          <DayCard
            key={`${day.id}-${i}`}
            day={day}
            rows={detail.get(day.id) ?? []}
            // Any day can be started, not just the suggested one — otherwise
            // the only route to Workout B is finishing Workout A, which is
            // what drives people to log a junk set just to move the program on.
            // While a workout runs, cards go preview-only: tapping one would
            // silently close out the in-progress workout.
            startable={!active}
            highlight={i === 0 && !active}
            when={i === 0 ? "next" : "later"}
          />
        ))}
      </div>

      {/* Scrim so list content dissolves into the background beneath the
          floating CTA + dock instead of colliding with them (theme-aware via
          --oled). */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-40 bg-gradient-to-t from-oled via-oled/85 to-transparent"
      />

      {/* Sits a fixed gap ABOVE the dock: same safe-area anchor as the nav
          plus the dock's height, so it never lands on the tab bar. */}
      <Link
        href="/workout"
        className="fixed inset-x-4 bottom-[calc(max(env(safe-area-inset-bottom),12px)+5.5rem)] z-30 mx-auto block max-w-md rounded-full bg-accent py-4 text-center text-base font-semibold text-white shadow-[0_10px_36px_var(--accent-glow),inset_0_1px_0_rgba(255,255,255,0.35)]"
      >
        {active ? "Resume workout" : "Start workout"}
      </Link>
    </div>
  );
}

function DayCard({
  day,
  rows,
  startable,
  highlight,
  when,
}: {
  day: ProgramDay;
  rows: { pe: ProgramExercise; ex: Exercise }[];
  /** Tapping starts this day. Separate from `highlight`: the program
   * SUGGESTS an order, it doesn't impose one — any day can be started. */
  startable: boolean;
  /** Visual emphasis for the day the program suggests next. */
  highlight: boolean;
  when: string;
}) {
  const shown = rows.slice(0, 3);
  const extra = rows.length - shown.length;
  const inner = (
    <>
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h2 className="disp truncate text-[16px]">{day.name}</h2>
        <span className="mono flex-none text-xs text-ink-faint">{when}</span>
      </div>
      {shown.map(({ pe, ex }) => (
        <div key={pe.id} className="flex items-baseline justify-between py-1.5">
          <span className="text-[14.5px] text-ink">{ex.name}</span>
          <span className="mono text-[13px] text-ink-dim">
            {targetLabel(pe)}
          </span>
        </div>
      ))}
      {extra > 0 && (
        <div className="mt-1.5 border-t border-line pt-2 text-[12.5px] text-ink-faint">
          + {extra} more exercise{extra === 1 ? "" : "s"}
        </div>
      )}
    </>
  );

  const className = `glass p-4${highlight ? "" : " opacity-80"}${
    startable ? " transition-colors active:border-accent" : ""
  }`;

  return startable ? (
    <Link href={`/workout?day=${day.id}`} className={className}>
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
