"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import { useUser } from "@/state/UserContext";
import { AppHeader } from "@/components/AppHeader";
import type { ProgramExercise, Exercise } from "@/lib/types";

export default function ProgramPage() {
  const { user } = useUser();

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
    return { program, days, detail };
  }, [user?.id]);

  if (!user || !data) return null;
  const { program, days, detail } = data;
  const isProgression = program.mode === "progression";

  return (
    <div className="pb-8">
      <AppHeader
        title="Program"
        sub={`${program.name} · ${isProgression ? "auto progression" : "last session prefills"}`}
      />
      <div className="flex flex-col gap-3">
        {days.map((day) => (
          <section key={day.id} className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="disp mb-2 text-[15.5px]">{day.name}</h2>
            {(detail.get(day.id) ?? []).map(({ pe, ex }) => (
              <div key={pe.id} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate text-[14.5px]">{ex.name}</span>
                <EditableTarget pe={pe} ex={ex} editable={isProgression} />
              </div>
            ))}
          </section>
        ))}

        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="disp mb-1 text-[15.5px]">Progression</h2>
          <p className="text-[13.5px] leading-relaxed text-ink-dim">
            {isProgression
              ? "Weights advance automatically after every successful workout and deload 10% after three fails. Adjust a working weight above at any time."
              : "No automatic progression — every set prefills from your last session, and you change the numbers as you go."}
          </p>
        </section>
      </div>
    </div>
  );
}

function EditableTarget({
  pe,
  ex,
  editable,
}: {
  pe: ProgramExercise;
  ex: Exercise;
  editable: boolean;
}) {
  const scheme = pe.targetSeconds
    ? `${pe.sets}×${pe.targetSeconds}s`
    : `${pe.sets}×${pe.targetReps ?? ""}`;

  if (!editable || pe.workingWeightKg === undefined) {
    const rest = pe.restSeconds ?? ex.restSeconds;
    return (
      <span className="mono flex-none text-[13px] text-ink-dim">
        {scheme}
        {rest > 0 ? ` · rest ${rest}s` : ""}
      </span>
    );
  }

  return (
    <span className="mono flex flex-none items-center gap-1.5 text-[13px] text-ink-dim">
      {scheme}
      <input
        className="setfield max-w-[72px]"
        type="number"
        inputMode="decimal"
        step="0.5"
        aria-label={`${ex.name} working weight in kg`}
        defaultValue={pe.workingWeightKg}
        onBlur={async (e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) {
            await db.programExercises.update(pe.id, { workingWeightKg: v });
          }
        }}
      />
      kg
    </span>
  );
}
