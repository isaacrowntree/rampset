"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/state/UserContext";
import {
  nextProgramDay,
  startWorkout,
  finishWorkout,
  type Session,
} from "@/db/session";
import { db } from "@/db/db";
import { ProgressionWorkout } from "@/components/workout/ProgressionWorkout";
import { RoutineWorkout } from "@/components/workout/RoutineWorkout";
import { useRestTimer, RestTimerBar } from "@/components/RestTimer";
import { useWakeLock } from "@/lib/useWakeLock";

const ACTIVE_WORKOUT_KEY = "liftlog.activeWorkout";

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
  const [session, setSession] = useState<Session | null>(null);
  const timer = useRestTimer();
  useWakeLock(session !== null);

  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    (async () => {
      // Resume an unfinished workout for this user if one exists.
      const activeId = localStorage.getItem(`${ACTIVE_WORKOUT_KEY}.${user.id}`);
      if (activeId) {
        const existing = await db.workouts.get(activeId);
        if (existing && existing.endTs === undefined && existing.programDayId) {
          const { buildSessionPlan } = await import("@/db/session");
          const plan = await buildSessionPlan(user.id, existing.programDayId);
          if (!cancelled) setSession({ workout: existing, ...plan });
          return;
        }
        localStorage.removeItem(`${ACTIVE_WORKOUT_KEY}.${user.id}`);
      }

      const day = requestedDay
        ? await db.programDays.get(requestedDay)
        : await nextProgramDay(user.id);
      if (!day) {
        router.replace("/");
        return;
      }
      const s = await startWorkout(user.id, day.id);
      localStorage.setItem(`${ACTIVE_WORKOUT_KEY}.${user.id}`, s.workout.id);
      if (!cancelled) setSession(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user, requestedDay, router]);

  if (!user || !session) {
    return <div className="pt-20 text-center text-sm text-ink-faint">Setting up your workout…</div>;
  }

  const finish = async () => {
    timer.stop();
    await finishWorkout(session.workout.id);
    localStorage.removeItem(`${ACTIVE_WORKOUT_KEY}.${user.id}`);
    router.push("/");
  };

  const discard = async () => {
    timer.stop();
    await db.sets.where({ workoutId: session.workout.id }).delete();
    await db.workouts.delete(session.workout.id);
    localStorage.removeItem(`${ACTIVE_WORKOUT_KEY}.${user.id}`);
    router.push("/");
  };

  return (
    <div className="pb-32">
      <header className="mb-2 flex items-center justify-between pt-2">
        <button
          onClick={discard}
          aria-label="Discard workout"
          className="px-1 py-2 text-ink-dim"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <span className="disp max-w-[230px] truncate rounded-full border border-line bg-surface-2 px-4 py-2 text-[14px]">
          {session.day.name}
        </span>
        <button
          onClick={finish}
          className="px-1 py-2 text-[15px] font-semibold text-plate-10"
        >
          Finish
        </button>
      </header>

      {session.mode === "progression" ? (
        <ProgressionWorkout session={session} onSetDone={timer.start} />
      ) : (
        <RoutineWorkout session={session} onSetDone={timer.start} />
      )}

      <RestTimerBar {...timer} onSkip={timer.stop} />
    </div>
  );
}
