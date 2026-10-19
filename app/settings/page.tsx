"use client";

import { Switch } from "@/components/Switch";
import { useGymHas25s, setGymHas25s } from "@/lib/gymPlates";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import { useUser } from "@/state/UserContext";
import { AppHeader } from "@/components/AppHeader";
import { exportBackup, restoreBackup } from "@/db/backup";
import { backupToCloud, restoreFromCloud } from "@/lib/cloudBackup";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { Chevron } from "@/components/Chevron";
import { PROGRAM_TEMPLATES, getTemplate } from "@/lib/programTemplates";
import { switchProgram } from "@/db/programSwitch";
import { scheduleBackup } from "@/lib/backupAfterEdit";
import { SyncStatusRow } from "@/components/SyncStatusRow";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Sheet } from "@/components/Sheet";
import { EmailCodeForm } from "@/components/account/EmailCodeForm";
import { legacyProfiles, moveLegacyProfile, unsyncedCount, type LegacyProfile } from "@/db/account";
import { getActiveWorkout } from "@/db/activeWorkout";
import { enqueueWorkouts } from "@/db/sync";
import { importIntoStore } from "@/db/importStore";
import { parseExport, type DetectedExport } from "@/lib/importers/detect";
import {
  authConfig,
  authErrorMessage,
  deleteAccount,
  signInWithPasskey,
  signOut,
  updateProfile,
} from "@/lib/auth";

export default function SettingsPage() {
  const { user, session, adopt, refresh, patchUser, leave } = useUser();
  const [signingIn, setSigningIn] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<DetectedExport | null>(null);
  const [emailOffered, setEmailOffered] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<
    { kind: "sign-out"; unsynced: number; inProgress: boolean } | { kind: "delete" } | null
  >(null);
  const [pendingMove, setPendingMove] = useState<LegacyProfile | null>(null);
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

  // Lifters this phone held before accounts, other than the account itself.
  const legacy = useLiveQuery(
    async () => (user ? (await legacyProfiles()).filter((p) => p.id !== user.id) : []),
    [user?.id],
    [] as LegacyProfile[],
  );

  const program = useLiveQuery(
    async () => (user ? await db.programs.where({ userId: user.id }).first() : null),
    [user?.id],
  );

  useEffect(() => {
    authConfig().then((c) => setEmailOffered(c.email), () => {});
  }, []);

  if (!user) return null;

  // `next dev`, or a self-host without accounts: everything lives here.
  const deviceOnly = user.id.startsWith("local_");
  // Account and cloud actions need the server to know who this is.
  const canReachAccount = !deviceOnly && session !== "signed-out";

  /** Errors render at the bottom of the page, so bring them into view. */
  const showError = (message: string) => {
    setNotice(null);
    setError(message);
    requestAnimationFrame(() => errorRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
  };

  const fail = (prefix: string) => (e: unknown) =>
    showError(`${prefix}: ${e instanceof Error ? e.message : String(e)}`);

  const signBackIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    setError(null);
    try {
      const account = await signInWithPasskey();
      // One account per device: someone else's passkey mustn't quietly
      // replace what's on this one.
      if (account.id !== user.id) {
        showError("That passkey is for a different account. Sign out first to switch accounts.");
        return;
      }
      await adopt(account);
    } catch (e) {
      const message = authErrorMessage(e, "Couldn't sign in — try again.");
      if (message) showError(message);
    } finally {
      setSigningIn(false);
    }
  };

  /** A skin is this device's choice first; the account catches up when it
   * can (see patchUser), so the next new phone starts in it too. */
  const setTheme = (theme: "dark" | "light") => void patchUser({ theme });

  const askSignOut = async () =>
    setPendingLeave({
      kind: "sign-out",
      unsynced: deviceOnly ? 0 : await unsyncedCount(user.id),
      inProgress: Boolean(await getActiveWorkout(user.id)),
    });

  const confirmLeave = async () => {
    const action = pendingLeave;
    setPendingLeave(null);
    if (!action) return;
    setError(null);
    setNotice(action.kind === "delete" ? "Deleting your account…" : "Signing out…");
    try {
      if (action.kind === "delete") {
        await deleteAccount();
      } else if (!deviceOnly) {
        // Last chance for the cloud copy to catch up (program edits, imports
        // wait on a debounce). Best effort — the outbox count was the warning.
        await backupToCloud(user.id).catch(() => {});
        // Must reach the server: offline, the session would outlive the wipe
        // and the next online launch would sign straight back in.
        await signOut();
      }
      await leave();
    } catch (e) {
      const message = authErrorMessage(e, "try again");
      showError(
        action.kind === "delete"
          ? `Couldn't delete the account: ${message}`
          : "Couldn't sign out — you need a connection to sign out. Your data is still here.",
      );
    }
  };

  const pickImport = async (f: File) => {
    setError(null);
    setNotice(null);
    const detected = parseExport(await f.text());
    if (importRef.current) importRef.current.value = "";
    if (!detected) {
      setError(
        "This file doesn't look like a StrongLifts or Strong export. Use the CSV straight from the app's export screen.",
      );
      return;
    }
    setPendingImport(detected);
  };

  const runImport = async (detected: DetectedExport) => {
    setPendingImport(null);
    setNotice("Importing…");
    try {
      const s = await importIntoStore(user.id, detected.result);
      scheduleBackup(user.id);
      if (canReachAccount) void enqueueWorkouts(user.id, s.workoutIds);
      setNotice(
        `Imported ${s.workoutsAdded.toLocaleString()} workouts${
          s.workoutsSkipped ? ` (${s.workoutsSkipped.toLocaleString()} already here, skipped)` : ""
        }.`,
      );
    } catch (e) {
      fail("Import failed")(e);
    }
  };

  const downloadBackup = async () => {
    const json = await exportBackup(user.id);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rampset-backup-${fileSlug(user.name)}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice("Backup downloaded. Keep it somewhere safe — it restores everything.");
  };

  const handleRestore = async (file: File) => {
    setError(null);
    setNotice(null);
    try {
      const s = await restoreBackup(user.id, await file.text());
      scheduleBackup(user.id);
      if (canReachAccount) void enqueueWorkouts(user.id, await finishedWorkoutIds(user.id));
      setNotice(
        `Restored ${s.workouts.toLocaleString()} workouts, ${s.sets.toLocaleString()} sets, ${s.exercises} exercises.`,
      );
    } catch (e) {
      fail("Restore failed")(e);
    } finally {
      if (restoreRef.current) restoreRef.current.value = "";
    }
  };

  const moveIn = async (profile: LegacyProfile) => {
    setPendingMove(null);
    setError(null);
    setNotice(`Moving ${profile.name}'s history…`);
    try {
      const { workoutIds } = await moveLegacyProfile(profile.id, user.id);
      scheduleBackup(user.id);
      if (canReachAccount) void enqueueWorkouts(user.id, workoutIds);
      setNotice(`Moved ${workoutIds.length.toLocaleString()} workouts into your account.`);
    } catch (e) {
      fail("Couldn't move that history")(e);
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
    a.download = `rampset-${fileSlug(user.name)}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pb-8">
      <AppHeader title="Settings" />

      <h2 className="eyebrow mb-2 px-4">Account</h2>
      <div className="mb-5 glass">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
          <span
            className="disp flex h-8 w-8 flex-none items-center justify-center rounded-full text-[12px] text-white"
            style={{ background: user.accent === "green" ? "var(--plate-10)" : "var(--plate-20)" }}
            aria-hidden
          >
            {user.name[0]?.toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">{user.name}</span>
            <span className="block text-[12.5px] leading-snug text-ink-faint">
              {deviceOnly
                ? "On this device only — no sync"
                : session === "signed-out"
                  ? "Signed out — sync and backup are paused"
                  : "Signed in with a passkey"}
            </span>
          </span>
        </div>

        {!deviceOnly && session === "signed-out" && (
          <button
            onClick={() => void signBackIn()}
            disabled={signingIn}
            className="flex min-h-[44px] w-full items-center border-b border-line px-4 py-3.5 text-left text-[15px] font-medium text-accent disabled:opacity-60"
          >
            {signingIn ? "Signing in…" : "Sign in with passkey"}
          </button>
        )}

        {canReachAccount && (emailOffered || user.email) && (
          <button
            onClick={() => setEditingEmail(true)}
            className="flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3.5 text-left"
          >
            <span className="min-w-0">
              <span className="block text-[15px] font-medium">
                {user.email ? "Recovery email" : "Add recovery email"}
              </span>
              <span className="block truncate text-[12.5px] text-ink-faint">
                {user.email || "Gets you back in if you lose every device"}
              </span>
            </span>
            <Chevron />
          </button>
        )}

        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-[15px] font-medium">Appearance</span>
          <div className="w-40">
            <SegmentedControl
              label="Appearance"
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
              value={user.theme ?? "dark"}
              onChange={(t) => void setTheme(t)}
            />
          </div>
        </div>
      </div>

      <h2 className="eyebrow mb-2 px-4">Workout</h2>
      <div className="mb-5 glass">
        <RestTimerSetting userId={user.id} />
        <div className="px-4 pb-3 text-[12.5px] leading-relaxed text-ink-faint">
          After a successful set. Missed reps always rest 5 minutes (SL
          guidance: 1:30 easy · 3:00 hard · 5:00 failed). Routine exercises
          keep their own per-exercise rest.
        </div>
      </div>

      <h2 className="eyebrow mb-2 px-4">Gym</h2>
      <div className="mb-1 glass">
        <GymPlatesSetting />
      </div>
      <p className="mb-5 px-4 text-[12.5px] leading-relaxed text-ink-faint">
        Plate loading uses the plates your gym has. Turn this off if your
        heaviest plate is 20kg.
      </p>

      <h2 className="eyebrow mb-2 px-4">Program</h2>
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
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-accent" role="img" aria-label="active">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
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

      {legacy.length > 0 && (
        <>
          <h2 className="eyebrow mb-2 px-4">From before accounts</h2>
          <div className="mb-1 glass">
            {legacy.map((p) => (
              <button
                key={p.id}
                onClick={() => setPendingMove(p)}
                className="flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3.5 text-left last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium">{p.name}</span>
                  <span className="block text-[12.5px] text-ink-faint">
                    {p.workouts.toLocaleString()} {p.workouts === 1 ? "workout" : "workouts"} on this phone
                  </span>
                </span>
                <Chevron />
              </button>
            ))}
          </div>
          <p className="mb-5 px-4 text-[12.5px] leading-relaxed text-ink-faint">
            History this phone kept before accounts. Move yours into your account to sync it.
          </p>
        </>
      )}

      <h2 className="eyebrow mb-2 px-4">Your data</h2>
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

        {!deviceOnly && <SyncStatusRow />}

        {canReachAccount && (
          <>
        <button
          onClick={async () => {
            setError(null);
            setNotice("Backing up to cloud…");
            const r = await backupToCloud(user.id);
            if (r.ok) setNotice("Backed up. A snapshot also runs after every workout.");
            else {
              showError(`Cloud backup failed: ${r.error}`);
            }
          }}
          className="flex w-full items-center justify-between border-b border-line px-4 py-3.5 text-left"
        >
          <div>
            <div className="text-[15px] font-medium">Back up to cloud</div>
            <div className="text-[12.5px] text-ink-faint">
              Snapshot of everything — also runs after every workout
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
              Replace this device&apos;s history with the latest snapshot
            </div>
          </div>
          <span className="mono text-accent">↓</span>
        </button>
          </>
        )}

        <button
          onClick={downloadBackup}
          className="flex w-full items-center justify-between border-b border-line px-4 py-3.5 text-left"
        >
          <div>
            <div className="text-[15px] font-medium">Download backup</div>
            <div className="text-[12.5px] text-ink-faint">
              Everything — programs, weights, history — as a file you keep
            </div>
          </div>
          <span className="mono text-accent">↓</span>
        </button>

        <button
          onClick={() => restoreRef.current?.click()}
          className="flex w-full items-center justify-between border-b border-line px-4 py-3.5 text-left"
        >
          <div>
            <div className="text-[15px] font-medium">Restore from backup file</div>
            <div className="text-[12.5px] text-ink-faint">
              Replaces this device&apos;s history with a downloaded backup
            </div>
          </div>
          <span className="mono text-accent">↑</span>
        </button>
        <input
          ref={restoreRef}
          type="file"
          accept=".json,application/json"
          aria-label="Restore from backup file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPendingRestore({ kind: "file", file: f });
          }}
        />

        <button
          onClick={() => importRef.current?.click()}
          className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        >
          <div>
            <div className="text-[15px] font-medium">Import from another app</div>
            <div className="text-[12.5px] text-ink-faint">
              StrongLifts or Strong CSV export — added to your history
            </div>
          </div>
          <span className="mono text-accent">↑</span>
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="Import from another app"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickImport(f);
          }}
        />
      </div>

      <div role="status" aria-live="polite">
        {notice && (
          <div className="mt-3 glass p-4 ring-1 ring-plate-10/40 text-[13.5px] leading-relaxed">
            {notice}
          </div>
        )}
      </div>
      {error && (
        <div ref={errorRef} role="alert" className="mt-3 glass p-4 ring-1 ring-plate-25/40 text-[13.5px] leading-relaxed">
          {error}
        </div>
      )}

      {/* Leaving goes last, on its own, like iOS. */}
      <div className="mt-5 glass">
        <button
          onClick={() => void askSignOut()}
          className={`flex min-h-[44px] w-full items-center px-4 py-3.5 text-left text-[15px] font-medium text-danger ${
            canReachAccount ? "border-b border-line" : ""
          }`}
        >
          {deviceOnly ? "Erase this device" : "Sign out"}
        </button>
        {canReachAccount && (
          <button
            onClick={() => setPendingLeave({ kind: "delete" })}
            className="flex min-h-[44px] w-full items-center px-4 py-3.5 text-left text-[15px] font-medium text-danger"
          >
            Delete account
          </button>
        )}
      </div>

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
                scheduleBackup(user.id);
                // A new device builds this program before restoring.
                void updateProfile({ profile: { templateId: id } }).catch(() => {});
                setNotice(`Switched to ${getTemplate(id)?.name ?? "the new program"}.`);
              })
              .catch(fail("Switch failed"))
              .finally(() => setSwitching(false));
          }}
        />
      )}

      {pendingRestore && (
        <ConfirmSheet
          title="Restore and replace?"
          body={
            pendingRestore.kind === "cloud"
              ? "This replaces everything on this device with the latest cloud snapshot."
              : "This replaces everything on this device with this backup file."
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
              void restoreFromCloud(user.id).then((r) => {
                if (r.ok && r.summary) {
                  setNotice(
                    `Restored ${r.summary.workouts.toLocaleString()} workouts, ${r.summary.sets.toLocaleString()} sets from cloud.`,
                  );
                } else {
                  showError(`Cloud restore failed: ${r.error}`);
                }
              });
            } else {
              void handleRestore(action.file);
            }
          }}
        />
      )}

      {pendingImport && (
        <ConfirmSheet
          title="Import history?"
          body={importSummary(pendingImport)}
          confirmLabel="Import"
          tone="positive"
          onCancel={() => setPendingImport(null)}
          onConfirm={() => void runImport(pendingImport)}
        />
      )}

      {pendingMove && (
        <ConfirmSheet
          title={`Move ${pendingMove.name}'s history?`}
          body={`${pendingMove.workouts.toLocaleString()} workouts, with that program and its weights, become your account's — replacing what's on this phone for it — and sync to your other devices.`}
          confirmLabel="Move into my account"
          tone="positive"
          onCancel={() => setPendingMove(null)}
          onConfirm={() => void moveIn(pendingMove)}
        />
      )}

      {pendingLeave && (
        <ConfirmSheet
          title={pendingLeave.kind === "delete" ? "Delete your account?" : deviceOnly ? "Erase this device?" : "Sign out?"}
          body={
            pendingLeave.kind === "delete"
              ? "This permanently deletes your account, your synced workouts and your cloud backups, and erases this device. Download a backup first if you want to keep your history."
              : deviceOnly
                ? "Your history lives only on this device, so this deletes it. Download a backup first if you want to keep it."
                : [
                    pendingLeave.unsynced
                      ? `${pendingLeave.unsynced} ${pendingLeave.unsynced === 1 ? "workout hasn't" : "workouts haven't"} synced yet and will be lost.`
                      : "",
                    pendingLeave.inProgress ? "The workout in progress will be lost." : "",
                    legacy.length
                      ? `History from before accounts (${legacy.map((p) => p.name).join(", ")}) is erased too.`
                      : "",
                    "This clears Rampset from this device. Sign back in to get your history back.",
                  ]
                    .filter(Boolean)
                    .join(" ")
          }
          confirmLabel={pendingLeave.kind === "delete" ? "Delete account" : deviceOnly ? "Erase this device" : "Sign out"}
          onCancel={() => setPendingLeave(null)}
          onConfirm={() => void confirmLeave()}
        />
      )}

      {editingEmail && (
        <Sheet label="Recovery email" onClose={() => setEditingEmail(false)}>
          <h2 className="disp mb-1 text-[19px]">{user.email ? "Change recovery email" : "Recovery email"}</h2>
          <p className="mb-4 text-[15px] leading-snug text-ink-dim">
            {user.email ? `Currently ${user.email}. ` : ""}Your passkey is your login. If you lose
            every device it&apos;s on, a code sent here gets you back in.
          </p>
          <EmailCodeForm
            purpose="add-email"
            onDone={(account) => {
              setEditingEmail(false);
              void refresh(account);
              setNotice(`Recovery email set to ${account.email}.`);
            }}
          />
        </Sheet>
      )}

      <h2 className="eyebrow mb-2 mt-5 px-4">About</h2>
      <div className="glass px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-faint">
        Rampset runs on this device — every workout is stored locally and works
        offline.
        {!deviceOnly && " Your account keeps your devices in sync and backs your history up to the cloud."}
      </div>
    </div>
  );
}

function GymPlatesSetting() {
  const has25s = useGymHas25s();
  return (
    // The whole row toggles, not just the 51×31 switch.
    <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-3 px-4 py-2">
      <span className="text-[17px]">25kg plates</span>
      <Switch checked={has25s} onChange={setGymHas25s} label="Gym has 25kg plates" />
    </label>
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
        <span className="block text-[13px] text-ink-faint">Seconds between sets</span>
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

function importSummary({ source, result }: DetectedExport): string {
  const dates = result.workouts.map((w) => w.date).sort();
  const fmt = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const n = result.workouts.length;
  return `Found ${n.toLocaleString()} ${n === 1 ? "workout" : "workouts"} from ${source}, ${fmt(dates[0])} – ${fmt(
    dates[dates.length - 1],
  )}. They're added to your history; nothing is replaced, and workouts already here are skipped.`;
}

async function finishedWorkoutIds(userId: string): Promise<string[]> {
  return (await db.workouts.where({ userId }).toArray()).filter((w) => w.endTs !== undefined).map((w) => w.id);
}

function fileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lifter";
}

function csv(v: string): string {
  return v.includes(",") || v.includes('"') ? `"${v.replaceAll('"', '""')}"` : v;
}
