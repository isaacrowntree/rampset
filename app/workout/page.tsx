"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/state/UserContext";
import {
  nextProgramDay,
  startWorkout,
  buildSessionPlan,
  setWorkoutNote,
  saveFinishedWorkout,
  buildEditSession,
  type Session,
} from "@/db/session";
import { db } from "@/db/db";
import { ProgressionWorkout } from "@/components/workout/ProgressionWorkout";
import { RoutineWorkout } from "@/components/workout/RoutineWorkout";
import { MadcowWorkout } from "@/components/workout/MadcowWorkout";
import { useRestTimer, RestTimerBar } from "@/components/RestTimer";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { Sheet } from "@/components/Sheet";
import { useWakeLock } from "@/lib/useWakeLock";
import { usePullToDismiss } from "@/lib/usePullToDismiss";
import { activeWorkoutKey } from "@/db/activeWorkout";
import { completeWorkout } from "@/lib/finishFlow";
import { sessionTonnageKg, workSetCount } from "@/lib/workoutStats";
import { scheduleBackup } from "@/lib/backupAfterEdit";
import { enqueueEditedWorkout } from "@/db/sync";

export default function WorkoutPage() {
  return (
    <Suspense fallback={null}>
      <WorkoutScreen />
    </Suspense>
  );
}

function WorkoutScreen() {
  const { user, ready } = useUser();
  const router = useRouter();
  const params = useSearchParams();
  const requestedDay = params.get("day");
  // A finished workout reopened from History: same screen, but it stays
  // finished — Save replaces Finish, and nothing touches the active pointer.
  const editId = params.get("edit");
  const [session, setSession] = useState<Session | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [confirmingFinish, setConfirmingFinish] = useState<{
    workSets: number;
    tonnageKg: number;
  } | null>(null);
  const finishing = useRef(false);
  /** Set before any router.replace out of this screen, so the confirm sheet
   * doesn't also pop a history entry the router already consumed. */
  const navigatingAway = useRef(false);
  const [discardCount, setDiscardCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const timer = useRestTimer();
  useWakeLock(session !== null);

  // Pull down from the top to minimize, like Now Playing. Editing a past
  // workout pulls back to History instead.
  const screenRef = useRef<HTMLDivElement>(null);
  usePullToDismiss(
    screenRef,
    () => {
      if (!editId) router.push("/");
      else if (window.history.length > 1) router.back();
      else router.replace("/history");
    },
    session !== null && !confirmingFinish && !confirmingDiscard && !noteOpen,
  );

  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    (async () => {
      if (editId) {
        const past = await db.workouts.get(editId);
        if (
          !past ||
          past.userId !== user.id ||
          past.endTs === undefined ||
          !past.programDayId ||
          !(await db.programDays.get(past.programDayId))
        ) {
          router.replace("/history");
          return;
        }
        const s = await buildEditSession(past);
        if (!cancelled) setSession(s);
        return;
      }

      const storageKey = activeWorkoutKey(user.id);
      const activeId = localStorage.getItem(storageKey);
      const active = activeId ? await db.workouts.get(activeId) : undefined;

      if (active && active.endTs === undefined && active.programDayId) {
        // An in-progress workout ALWAYS wins, even if a different day was
        // requested — it must never be finished silently behind the user's
        // back (that skipped the Finish confirm, the congrats, and History).
        // To start a different day, finish or discard this one first.
        const plan = await buildSessionPlan(user.id, active.programDayId);
        if (!cancelled) setSession({ workout: active, ...plan });
        return;
      } else if (activeId) {
        localStorage.removeItem(storageKey);
      }

      const day = requestedDay
        ? await db.programDays.get(requestedDay)
        : await nextProgramDay(user.id);
      if (!day) {
        router.replace("/");
        return;
      }
      if (cancelled) return; // a dead mount must not start anything
      const s = await startWorkout(user.id, day.id);
      if (cancelled) return;
      localStorage.setItem(storageKey, s.workout.id);
      setSession(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user, requestedDay, editId, router]);

  if (!user || !session) {
    return (
      <div aria-hidden className="pt-[max(env(safe-area-inset-top),16px)] motion-safe:animate-pulse">
        <div className="glass mx-auto mb-6 h-10 w-44 rounded-full" />
        <div className="glass mb-3 h-32" />
        <div className="glass mb-3 h-32" />
        <div className="glass h-32 opacity-60" />
      </div>
    );
  }

  const askFinish = async () => {
    const sets = await db.sets.where({ workoutId: session.workout.id }).toArray();
    setConfirmingFinish({
      workSets: workSetCount(sets),
      tonnageKg: sessionTonnageKg(sets),
    });
  };

  const finish = async (tonnageKg: number, workSets: number) => {
    if (finishing.current) return; // double-tap guard
    finishing.current = true;
    timer.stop();
    try {
      // Local commit + congrats + navigation happen instantly; sync/backup are
      // fired detached, so a slow connection can't freeze the Finish flow.
      await completeWorkout(
        { userId: user.id, workoutId: session.workout.id, workSets, tonnageKg },
        {
          navigate: (path) => {
            navigatingAway.current = true;
            router.replace(path);
          },
        },
      );
    } finally {
      // Never latch the button dead: the workout is already committed
      // locally, so a failure here must leave Finish tappable again.
      finishing.current = false;
      setConfirmingFinish(null);
    }
  };

  /** Edit mode's Finish: the sets are already saved as they're logged, so
   * this just settles progression and backs up. */
  const saveEdit = async () => {
    if (finishing.current) return;
    finishing.current = true;
    // No timer.stop(): edit mode never starts one, and the rest running is
    // the in-progress workout's, not this one's.
    try {
      const recomputed = await saveFinishedWorkout(session.workout.id);
      // The correction goes to every phone, not just the next new one.
      await enqueueEditedWorkout(user.id, session.workout.id, recomputed).catch(() => {});
      scheduleBackup(user.id);
      navigatingAway.current = true;
      leaveEdit();
    } finally {
      finishing.current = false;
    }
  };

  /** Back out of editing a past workout to History — popping the entry
   * History pushed, or (deep-linked, nothing behind) replacing it. */
  const leaveEdit = () => {
    if (window.history.length > 1) router.back();
    else router.replace("/history");
  };

  /** Logging a set starts the rest — except when correcting a past workout:
   * the timer is global, and would clobber a live workout's rest. */
  const rest = (style: "up" | "down") => (seconds: number) => {
    if (!editId) timer.start(seconds, style);
  };

  /** Minimize keeps everything — including an active rest countdown. */
  const minimize = () => {
    router.push("/");
  };

  /** A program edit landed mid-workout (sets/reps/weight from the exercise
   * sheet) — rebuild targets and warmups in place; logged sets live in the
   * DB and are untouched. */
  const refreshPlan = async () => {
    const plan = await buildSessionPlan(user.id, session.day.id);
    setSession((s) => (s ? { workout: s.workout, ...plan } : s));
  };

  const openNote = () => {
    setNoteDraft(session.workout.notes ?? "");
    setNoteOpen(true);
  };
  const saveNote = async () => {
    const trimmed = noteDraft.trim();
    await setWorkoutNote(session.workout.id, trimmed);
    setSession((s) => (s ? { ...s, workout: { ...s.workout, notes: trimmed } } : s));
    setNoteOpen(false);
  };

  const askDiscard = async () => {
    const count = await db.sets.where({ workoutId: session.workout.id }).count();
    if (count === 0) {
      await discard();
      return;
    }
    setDiscardCount(count);
    setConfirmingDiscard(true);
  };

  const discard = async () => {
    timer.stop();
    await db.sets.where({ workoutId: session.workout.id }).delete();
    await db.workouts.delete(session.workout.id);
    localStorage.removeItem(activeWorkoutKey(user.id));
    navigatingAway.current = true;
    router.replace("/");
  };

  return (
    // Bottom room for the rest-timer capsule, so it never sits on Finish.
    <div ref={screenRef} className="bg-oled pb-[calc(env(safe-area-inset-bottom)+132px)]">
      <header className="nav-inline sticky top-0 z-40 -mx-4 mb-2 flex items-center gap-1 px-2 pb-1.5 pt-[max(env(safe-area-inset-top),8px)]">
        <button
          onClick={editId ? leaveEdit : minimize}
          aria-label={
            editId ? "Back — logged changes are kept" : "Minimize workout — your progress is kept"
          }
          className="flex h-11 w-11 flex-none items-center justify-center text-accent"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-[17px] font-semibold leading-tight">{session.day.name}</div>
          {editId ? (
            <div className="text-[13px] leading-tight text-ink-dim">
              Editing · {formatDate(session.workout.date)}
            </div>
          ) : (
            <ElapsedClock startTs={session.workout.startTs} />
          )}
        </div>

        <div className="relative flex flex-none items-center">
          <button
            aria-label="Workout options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className="flex h-11 w-11 items-center justify-center text-accent"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="5" cy="12" r="1.9" />
              <circle cx="12" cy="12" r="1.9" />
              <circle cx="19" cy="12" r="1.9" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <button
                aria-hidden
                tabIndex={-1}
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div
                role="menu"
                className="menu-pop menu-surface absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-[18px] py-1"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    openNote();
                  }}
                  className={`flex w-full items-center gap-2.5 px-4 py-3 text-left text-[14px] font-medium text-ink ${
                    editId ? "" : "border-b border-line"
                  }`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                  {session.workout.notes ? "Edit note" : "Workout note"}
                </button>
                {/* A finished workout is synced history — deleting it isn't
                    a discard, so edit mode doesn't offer one. */}
                {!editId && <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void askDiscard();
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[14px] font-medium text-plate-25"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
                  </svg>
                  Discard workout
                </button>}
              </div>
            </>
          )}
        </div>
      </header>

      {session.workout.notes && (
        <button
          onClick={openNote}
          className="mb-3 flex w-full items-start gap-2 glass p-3 text-left"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-0.5 flex-none text-ink-faint" aria-hidden>
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>
          <span className="flex-1 text-[13px] italic leading-snug text-ink-dim">
            {session.workout.notes}
          </span>
        </button>
      )}

      {session.mode === "progression" ? (
        // SL-style: count up from the set, bell at the suggestion.
        <ProgressionWorkout
          session={session}
          onSetDone={rest("up")}
          onProgramChange={() => void refreshPlan()}
          // A past workout edits its own sets, not the live program.
          programLocked={editId !== null}
        />
      ) : session.mode === "madcow" ? (
        // Ramp checklist: prescribed climb, count down the exercise's rest.
        <MadcowWorkout session={session} onSetDone={rest("down")} />
      ) : (
        // Strong-style: count down the exercise's rest, done at zero.
        <RoutineWorkout session={session} onSetDone={rest("down")} />
      )}

      {/* Primary action lives at the end of the set list — finish once the
          last set is logged, rather than reaching for the header. */}
      <button
        onClick={editId ? () => void saveEdit() : askFinish}
        className="mt-8 block w-full rounded-full bg-plate-10 py-3.5 text-center text-[17px] font-semibold text-black"
      >
        {editId ? "Save workout" : "Finish workout"}
      </button>

      {confirmingFinish && (
        <ConfirmSheet
          title="Finish workout?"
          body={
            confirmingFinish.workSets === 0
              ? "You haven’t logged any sets, so this workout won’t be saved."
              : `${confirmingFinish.workSets} set${
                  confirmingFinish.workSets === 1 ? "" : "s"
                } logged${
                  confirmingFinish.tonnageKg > 0
                    ? ` · ${Math.round(confirmingFinish.tonnageKg).toLocaleString()}kg moved`
                    : ""
                }. ${session.day.name} will be saved to History.`
          }
          confirmLabel={confirmingFinish.workSets === 0 ? "Discard workout" : "Finish workout"}
          tone={confirmingFinish.workSets === 0 ? "danger" : "positive"}
          keepHistoryOnUnmount={navigatingAway}
          onConfirm={() =>
            void finish(confirmingFinish.tonnageKg, confirmingFinish.workSets)
          }
          onCancel={() => setConfirmingFinish(null)}
        />
      )}

      {confirmingDiscard && (
        <ConfirmSheet
          title="Discard this workout?"
          body={`${discardCount} logged set${discardCount === 1 ? "" : "s"} will be deleted. This can't be undone.`}
          confirmLabel={`Delete ${discardCount} set${discardCount === 1 ? "" : "s"}`}
          keepHistoryOnUnmount={navigatingAway}
          onConfirm={() => void discard()}
          onCancel={() => setConfirmingDiscard(false)}
        />
      )}

      {noteOpen && (
        <Sheet label="Workout note" onClose={() => setNoteOpen(false)}>
          <>
            <h2 className="disp mb-3 text-[19px]">Workout note</h2>
            <textarea
              data-selectable
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="How did it go? Bar speed, aches, PRs, what to change next time…"
              rows={4}
              className="w-full resize-none rounded-[12px] bg-fill p-3.5 text-[16px] leading-snug text-ink outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent"
            />
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => setNoteOpen(false)}
                className="glass flex-1 rounded-full py-3.5 text-[15px] font-medium text-ink"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveNote()}
                className="flex-1 rounded-full bg-accent py-3.5 text-[15px] font-semibold text-on-accent"
              >
                Save note
              </button>
            </div>
          </>
        </Sheet>
      )}

      {/* The running rest belongs to the live workout, not a past one. */}
      {!editId && <RestTimerBar {...timer} onDismiss={timer.stop} />}
    </div>
  );
}

/** Live workout duration in the header — ticks each second from the start. */
function ElapsedClock({ startTs }: { startTs?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!startTs) return null;
  const s = Math.max(0, Math.floor((now - startTs) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const label =
    h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${m}:${String(sec).padStart(2, "0")}`;
  // Readable from the bench: rounded tabular digits, not a footnote.
  return <div className="rounded-num text-[13px] leading-tight text-ink-dim">{label}</div>;
}

function formatDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
