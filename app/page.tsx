"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import { useUser } from "@/state/UserContext";
import { AppHeader } from "@/components/AppHeader";
import type { ProgramDay, ProgramExercise, Exercise } from "@/lib/types";

export default function HomePage() {
  const { user } = useUser();

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

    let nextIdx = 0;
    if (last?.programDayId) {
      const idx = days.findIndex((d) => d.id === last.programDayId);
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

    return { program, upcoming, detail, daysSince, workoutCount: finished.length };
  }, [user?.id]);

  if (!user || !data) return null;
  const { program, upcoming, detail, daysSince } = data;
  const isProgression = program.mode === "progression";

  return (
    <div>
      <AppHeader sub={today()} />

      {daysSince !== null && daysSince >= 14 && isProgression && (
        <div className="mb-4 flex items-center gap-3.5 rounded-2xl border border-plate-15/40 bg-plate-15/5 p-4">
          <p className="flex-1 text-[13.5px] leading-snug text-ink-dim">
            <strong className="font-semibold text-ink">
              {formatGap(daysSince)} since your last workout.
            </strong>{" "}
            Start lighter to avoid soreness.
          </p>
          <DeloadButton userId={user.id} />
        </div>
      )}
      {daysSince !== null && daysSince >= 14 && !isProgression && (
        <div className="mb-4 rounded-2xl border border-line bg-surface p-4">
          <p className="text-[13.5px] leading-snug text-ink-dim">
            <strong className="font-semibold text-ink">Welcome back.</strong>{" "}
            Last session was {formatGap(daysSince)} ago — your numbers are saved.
          </p>
        </div>
      )}

      <p className="eyebrow mb-2.5 mt-5 px-1">
        Up next · {program.name}
        <span className="mono ml-2 rounded-full border border-line px-2 py-0.5 text-[10px] normal-case tracking-normal text-ink-dim">
          {isProgression ? "program" : "routine"}
        </span>
      </p>

      <div className="flex flex-col gap-3 pb-24">
        {upcoming.map((day, i) => (
          <DayCard
            key={`${day.id}-${i}`}
            day={day}
            rows={detail.get(day.id) ?? []}
            highlight={i === 0}
            when={i === 0 ? "next" : "later"}
          />
        ))}
      </div>

      <Link
        href="/workout"
        className="fixed inset-x-4 bottom-24 z-30 mx-auto block max-w-md rounded-2xl bg-accent py-4 text-center text-base font-semibold text-white shadow-[0_10px_30px_var(--accent-glow)]"
      >
        Start workout
      </Link>
    </div>
  );
}

function DayCard({
  day,
  rows,
  highlight,
  when,
}: {
  day: ProgramDay;
  rows: { pe: ProgramExercise; ex: Exercise }[];
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

  return highlight ? (
    <Link
      href={`/workout?day=${day.id}`}
      className="rounded-2xl border border-line bg-surface p-4 transition-colors active:border-accent"
    >
      {inner}
    </Link>
  ) : (
    <div className="rounded-2xl border border-line bg-surface p-4 opacity-80">{inner}</div>
  );
}

function DeloadButton({ userId }: { userId: string }) {
  const apply = async () => {
    const program = await db.programs.where({ userId }).first();
    if (!program || program.mode !== "progression") return;
    const days = await db.programDays.where({ programId: program.id }).toArray();
    for (const day of days) {
      const pes = await db.programExercises.where({ programDayId: day.id }).toArray();
      for (const pe of pes) {
        if (pe.workingWeightKg && pe.workingWeightKg > 0) {
          const next = Math.floor((pe.workingWeightKg * 0.9) / 2.5) * 2.5;
          await db.programExercises.update(pe.id, { workingWeightKg: Math.max(next, 20) });
        }
      }
    }
  };
  return (
    <button
      onClick={apply}
      className="flex-none rounded-xl bg-plate-15 px-4 py-2.5 text-sm font-semibold text-black"
    >
      Deload
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
