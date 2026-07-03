"use client";

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import { useUser } from "@/state/UserContext";
import { AppHeader } from "@/components/AppHeader";
import { parseStrongLiftsCsv } from "@/lib/importers/stronglifts";
import { parseStrongCsv } from "@/lib/importers/strong";
import { importIntoStore, type ImportSummary } from "@/db/importStore";

export default function SettingsPage() {
  const { user, users, switchUser } = useUser();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useLiveQuery(async () => {
    if (!user) return null;
    return {
      workouts: await db.workouts.where({ userId: user.id }).count(),
      sets: await db.sets.where({ userId: user.id }).count(),
      exercises: await db.exercises.where({ userId: user.id }).count(),
    };
  }, [user?.id]);

  if (!user) return null;

  const handleFile = async (file: File) => {
    setImporting(true);
    setError(null);
    setSummary(null);
    try {
      const text = await file.text();
      const header = text.slice(0, 400);
      // Dialect auto-detect from the header row.
      const result = header.includes("Set Order")
        ? parseStrongCsv(text)
        : header.includes("Workout,Workout Name") || header.includes("Date (yyyy/mm/dd)")
          ? parseStrongLiftsCsv(text)
          : null;
      if (!result || result.workouts.length === 0) {
        setError(
          "This doesn't look like a StrongLifts or Strong export. Expected the CSV straight from either app's export screen.",
        );
        return;
      }
      const s = await importIntoStore(user.id, result);
      setSummary(s);
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const exportCsv = async () => {
    const workouts = await db.workouts.where({ userId: user.id }).sortBy("date");
    const sets = await db.sets.where({ userId: user.id }).toArray();
    const exercises = await db.exercises.where({ userId: user.id }).toArray();
    const exName = new Map(exercises.map((e) => [e.id, e.name]));
    const byWorkout = new Map<string, typeof sets>();
    for (const s of sets) {
      const list = byWorkout.get(s.workoutId) ?? [];
      list.push(s);
      byWorkout.set(s.workoutId, list);
    }
    const lines = ["date,workout,exercise,set,weight_kg,reps,seconds,is_warmup,note"];
    for (const w of workouts) {
      for (const s of byWorkout.get(w.id) ?? []) {
        lines.push(
          [
            w.date,
            csv(w.dayLabel),
            csv(exName.get(s.exerciseId) ?? ""),
            s.setIndex + 1,
            s.weightKg ?? "",
            s.reps ?? "",
            s.seconds ?? "",
            s.isWarmup ? 1 : 0,
            csv(s.note ?? ""),
          ].join(","),
        );
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `liftlog-${user.name.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pb-8">
      <AppHeader title="Settings" />

      <p className="eyebrow mb-2 px-1">Account</p>
      <div className="mb-5 rounded-2xl border border-line bg-surface">
        {users.map((u) => (
          <button
            key={u.id}
            onClick={() => switchUser(u.id)}
            className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left last:border-b-0"
          >
            <span
              className="disp flex h-8 w-8 flex-none items-center justify-center rounded-full text-[12px] text-white"
              style={{
                background: u.accent === "green" ? "var(--plate-10)" : "var(--plate-20)",
              }}
            >
              {u.name[0]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">{u.name}</span>
              <span className="block truncate text-[12.5px] text-ink-faint">{u.email}</span>
            </span>
            {u.id === user.id && (
              <span className="mono flex-none text-[11px] text-accent">active</span>
            )}
          </button>
        ))}
      </div>

      <p className="eyebrow mb-2 px-1">Data</p>
      <div className="rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
          <div>
            <div className="text-[15px] font-medium">This device</div>
            <div className="text-[12.5px] text-ink-faint">
              {counts
                ? `${counts.workouts.toLocaleString()} workouts · ${counts.sets.toLocaleString()} sets · ${counts.exercises} exercises`
                : "…"}
            </div>
          </div>
        </div>

        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="flex w-full items-center justify-between border-b border-line px-4 py-3.5 text-left"
        >
          <div>
            <div className="text-[15px] font-medium">
              {importing ? "Importing…" : "Import CSV"}
            </div>
            <div className="text-[12.5px] text-ink-faint">
              StrongLifts or Strong export — detected automatically
            </div>
          </div>
          <span className="mono text-accent">↑</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />

        <button
          onClick={exportCsv}
          className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        >
          <div>
            <div className="text-[15px] font-medium">Export CSV</div>
            <div className="text-[12.5px] text-ink-faint">Your data, no lock-in</div>
          </div>
          <span className="mono text-accent">↓</span>
        </button>
      </div>

      {summary && (
        <div className="mt-3 rounded-2xl border border-plate-10/40 bg-plate-10/5 p-4 text-[13.5px] leading-relaxed">
          Imported {summary.workoutsAdded.toLocaleString()} workouts and{" "}
          {summary.setsAdded.toLocaleString()} sets.
          {summary.workoutsSkipped > 0 &&
            ` Skipped ${summary.workoutsSkipped} already on this device.`}
          {summary.exercisesCreated.length > 0 &&
            ` Added ${summary.exercisesCreated.length} new exercises.`}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-2xl border border-plate-25/40 bg-plate-25/5 p-4 text-[13.5px] leading-relaxed">
          {error}
        </div>
      )}

      <p className="eyebrow mb-2 mt-5 px-1">About</p>
      <div className="rounded-2xl border border-line bg-surface px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-faint">
        LiftLog runs entirely on this device — every workout is stored locally and
        works offline. Deployment target: Cloudflare Workers behind Cloudflare
        Access ({users.map((u) => u.email).join(", ")}).
      </div>
    </div>
  );
}

function csv(v: string): string {
  return v.includes(",") || v.includes('"') ? `"${v.replaceAll('"', '""')}"` : v;
}
