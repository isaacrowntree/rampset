"use client";

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import { useUser } from "@/state/UserContext";
import { AppHeader } from "@/components/AppHeader";
import { exportBackup, restoreBackup } from "@/db/backup";
import { backupToCloud, restoreFromCloud } from "@/lib/cloudBackup";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { PROGRAM_TEMPLATES, getTemplate } from "@/lib/programTemplates";
import { switchProgram } from "@/db/programSwitch";
import { scheduleBackup } from "@/lib/backupAfterEdit";
import { SyncStatusRow } from "@/components/SyncStatusRow";

export default function SettingsPage() {
  const { user, users, switchUser } = useUser();
  const restoreRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<
    { kind: "file"; file: File } | { kind: "cloud" } | null
  >(null);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const counts = useLiveQuery(async () => {
    if (!user) return null;
    return {
      workouts: await db.workouts.where({ userId: user.id }).count(),
      sets: await db.sets.where({ userId: user.id }).count(),
      exercises: await db.exercises.where({ userId: user.id }).count(),
    };
  }, [user?.id]);

  const program = useLiveQuery(
    async () => (user ? await db.programs.where({ userId: user.id }).first() : null),
    [user?.id],
  );

  if (!user) return null;

  const downloadBackup = async () => {
    const json = await exportBackup(user.id);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `liftlog-backup-${user.name.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice("Backup downloaded. Keep it somewhere safe — it restores everything.");
  };

  const handleRestore = async (file: File) => {
    setError(null);
    setNotice(null);
    try {
      const s = await restoreBackup(user.id, await file.text());
      setNotice(
        `Restored ${s.workouts.toLocaleString()} workouts, ${s.sets.toLocaleString()} sets, ${s.exercises} exercises.`,
      );
    } catch (e) {
      setError(`Restore failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (restoreRef.current) restoreRef.current.value = "";
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
      <div className="mb-5 glass">
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

      <p className="eyebrow mb-2 px-1">Workout</p>
      <div className="mb-5 glass">
        <RestTimerSetting userId={user.id} />
        <div className="px-4 pb-3 text-[12.5px] leading-relaxed text-ink-faint">
          After a successful set. Missed reps always rest 5 minutes (SL
          guidance: 1:30 easy · 3:00 hard · 5:00 failed). Routine exercises
          keep their own per-exercise rest.
        </div>
      </div>

      <p className="eyebrow mb-2 px-1">Program</p>
      <div className="mb-5 glass">
        {PROGRAM_TEMPLATES.map((t) => {
          const active = program?.templateId === t.id;
          return (
            <button
              key={t.id}
              onClick={() => !active && setPendingSwitch(t.id)}
              disabled={active || switching}
              className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left last:border-b-0 disabled:opacity-100"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{t.name}</span>
                <span className="block text-[12.5px] leading-snug text-ink-faint">
                  {t.blurb}
                </span>
              </span>
              {active ? (
                <span className="mono flex-none text-[11px] text-accent">active</span>
              ) : (
                <span className="mono flex-none text-ink-faint">›</span>
              )}
            </button>
          );
        })}
        <p className="px-4 py-3 text-[12px] leading-relaxed text-ink-faint">
          Switching keeps every workout, set and exercise — your history and
          working weights carry across.
        </p>
      </div>

      <p className="eyebrow mb-2 px-1">Data</p>
      <div className="glass">
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
          onClick={exportCsv}
          className="flex w-full items-center justify-between border-b border-line px-4 py-3.5 text-left"
        >
          <div>
            <div className="text-[15px] font-medium">Export CSV</div>
            <div className="text-[12.5px] text-ink-faint">Portable spreadsheet of your sets</div>
          </div>
          <span className="mono text-accent">↓</span>
        </button>

        <SyncStatusRow />

        <button
          onClick={async () => {
            setError(null);
            setNotice("Backing up to cloud…");
            const r = await backupToCloud(user.id, user.email);
            if (r.ok) setNotice("Backed up to cloud (R2). A snapshot also runs after every workout.");
            else {
              setNotice(null);
              setError(`Cloud backup failed: ${r.error}`);
            }
          }}
          className="flex w-full items-center justify-between border-b border-line px-4 py-3.5 text-left"
        >
          <div>
            <div className="text-[15px] font-medium">Back up to cloud</div>
            <div className="text-[12.5px] text-ink-faint">
              Snapshot to R2 — automatic after every finished workout
            </div>
          </div>
          <span className="mono text-accent">↑</span>
        </button>

        <button
          onClick={() => setPendingRestore({ kind: "cloud" })}
          className="flex w-full items-center justify-between border-b border-line px-4 py-3.5 text-left"
        >
          <div>
            <div className="text-[15px] font-medium">Restore from cloud</div>
            <div className="text-[12.5px] text-ink-faint">
              Pull the latest R2 snapshot onto this device
            </div>
          </div>
          <span className="mono text-accent">↓</span>
        </button>

        <button
          onClick={downloadBackup}
          className="flex w-full items-center justify-between border-b border-line px-4 py-3.5 text-left"
        >
          <div>
            <div className="text-[15px] font-medium">Back up (JSON)</div>
            <div className="text-[12.5px] text-ink-faint">
              Complete snapshot — programs, weights, history. Restorable.
            </div>
          </div>
          <span className="mono text-accent">↓</span>
        </button>

        <button
          onClick={() => restoreRef.current?.click()}
          className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        >
          <div>
            <div className="text-[15px] font-medium">Restore from backup</div>
            <div className="text-[12.5px] text-ink-faint">
              Replaces this device&apos;s data with a backup file
            </div>
          </div>
          <span className="mono text-accent">↑</span>
        </button>
        <input
          ref={restoreRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPendingRestore({ kind: "file", file: f });
          }}
        />
      </div>

      {notice && (
        <div className="mt-3 glass border-plate-10/40 p-4 text-[13.5px] leading-relaxed">
          {notice}
        </div>
      )}
      {error && (
        <div className="mt-3 glass border-plate-25/40 p-4 text-[13.5px] leading-relaxed">
          {error}
        </div>
      )}

      {pendingSwitch && (
        <ConfirmSheet
          title={`Switch to ${getTemplate(pendingSwitch)?.name ?? "this program"}?`}
          body="Your workouts, sets and exercises are kept — history and working weights carry across. This only changes your program layout going forward."
          confirmLabel="Switch program"
          tone="positive"
          onCancel={() => setPendingSwitch(null)}
          onConfirm={() => {
            const id = pendingSwitch;
            setPendingSwitch(null);
            setSwitching(true);
            setError(null);
            void switchProgram(user.id, id)
              .then(() => {
                scheduleBackup(user.id, user.email);
                setNotice(`Switched to ${getTemplate(id)?.name ?? "the new program"}.`);
              })
              .catch((e) =>
                setError(`Switch failed: ${e instanceof Error ? e.message : String(e)}`),
              )
              .finally(() => setSwitching(false));
          }}
        />
      )}

      {pendingRestore && (
        <ConfirmSheet
          title="Restore and replace?"
          body={
            pendingRestore.kind === "cloud"
              ? "This replaces all data on this device for the active user with the latest cloud snapshot."
              : "This replaces all data on this device for the active user with the backup file's contents."
          }
          confirmLabel="Replace this device's data"
          onCancel={() => {
            setPendingRestore(null);
            if (restoreRef.current) restoreRef.current.value = "";
          }}
          onConfirm={() => {
            const action = pendingRestore;
            setPendingRestore(null);
            if (action.kind === "cloud") {
              setNotice("Restoring from cloud…");
              void restoreFromCloud(user.id, user.email).then((r) => {
                if (r.ok && r.summary) {
                  setNotice(
                    `Restored ${r.summary.workouts.toLocaleString()} workouts, ${r.summary.sets.toLocaleString()} sets from cloud.`,
                  );
                } else {
                  setNotice(null);
                  setError(`Cloud restore failed: ${r.error}`);
                }
              });
            } else {
              void handleRestore(action.file);
            }
          }}
        />
      )}

      <p className="eyebrow mb-2 mt-5 px-1">About</p>
      <div className="glass px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-faint">
        Rampset runs entirely on this device — every workout is stored locally and
        works offline. Deployment target: Cloudflare Workers behind Cloudflare
        Access ({users.map((u) => u.email).join(", ")}).
      </div>
    </div>
  );
}

function RestTimerSetting({ userId }: { userId: string }) {
  const stored = useLiveQuery(async () => {
    const { restDefaultKey } = await import("@/db/session");
    return db.settings.get(restDefaultKey(userId));
  }, [userId]);
  const seconds = typeof stored?.value === "number" ? stored.value : 90;

  return (
    <label className="flex items-center justify-between px-4 pb-1 pt-3.5">
      <span>
        <span className="block text-[15px] font-medium">Rest timer</span>
        <span className="block text-[12.5px] text-ink-faint">seconds between sets</span>
      </span>
      <input
        className="setfield max-w-[90px]" autoComplete="off" autoCorrect="off" spellCheck={false} onFocus={(e) => e.currentTarget.select()}
        type="number"
        inputMode="numeric"
        enterKeyHint="done"
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        min={15}
        step={15}
        value={seconds}
        aria-label="Default rest between successful sets, in seconds"
        onChange={async (e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 15 && v <= 900) {
            const { restDefaultKey } = await import("@/db/session");
            await db.settings.put({ key: restDefaultKey(userId), value: v });
          }
        }}
      />
    </label>
  );
}

function csv(v: string): string {
  return v.includes(",") || v.includes('"') ? `"${v.replaceAll('"', '""')}"` : v;
}
