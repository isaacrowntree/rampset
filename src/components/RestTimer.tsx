"use client";

/** SL-style rest stopwatch. Counts UP from the logged set — you always see
 * how long you've actually rested. The suggestion (1:30 easy · 5:00 fail)
 * is a marker: the bell/vibration/notification fire once when you reach it,
 * then the clock keeps running until the next set, the end of the workout,
 * or a manual dismiss. Wall-clock based (persisted start timestamp), so
 * backgrounding, navigation, and refresh can't lose it. */

import { useEffect, useRef, useState, useCallback } from "react";

const DASH = 113;
const PERSIST_KEY = "liftlog.restTimer";

/** SL rest ladder: 1:30 easy · 3:00 hard · 5:00 failed. When the count-up
 * stopwatch passes one marker, the bell rings and the next becomes the
 * target — only the last one flips the bar to "rest over". */
const REST_LADDER = [180, 300];

function nextLadderStep(after: number): number | undefined {
  return REST_LADDER.find((t) => t > after);
}

/** Two-tone gym bell via WebAudio — no asset, works offline. The context is
 * created inside the set-tap gesture (autoplay policy) and reused. */
function makeBell() {
  let ctx: AudioContext | null = null;
  return {
    prime() {
      try {
        type AC = typeof AudioContext;
        const Ctor: AC | undefined =
          window.AudioContext ??
          (window as { webkitAudioContext?: AC }).webkitAudioContext;
        if (!Ctor) return;
        ctx = ctx ?? new Ctor();
        if (ctx.state === "suspended") void ctx.resume();
      } catch {
        // no audio — vibration still fires
      }
    },
    ring() {
      if (!ctx) return;
      const play = () => {
        if (!ctx || ctx.state !== "running") return;
        strike(ctx);
      };
      // Long workouts suspend the context — wake it before striking.
      if (ctx.state === "suspended") void ctx.resume().then(play).catch(() => {});
      else play();
    },
  };
}

/** Gym-loud double strike: two partials per strike, repeated once. */
function strike(ctx: AudioContext) {
  try {
    for (const start of [0, 0.5]) {
      const t0 = ctx.currentTime + start;
      for (const [freq, at, dur] of [
        [1318.5, 0, 0.9], // E6
        [880, 0.12, 1.1], // A5
      ] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(0.5, t0 + at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + dur + 0.05);
      }
    }
  } catch {
    // ignore
  }
}

export type TimerStyle = "up" | "down";

interface PersistedRest {
  startTs: number;
  suggestion: number;
  rung: boolean;
  style: TimerStyle;
}

export function useRestTimer() {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [suggestion, setSuggestion] = useState(90);
  const [overdue, setOverdue] = useState(false);
  const [style, setStyle] = useState<TimerStyle>("up");
  const startTs = useRef<number>(0);
  const rung = useRef(false);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const bell = useRef<ReturnType<typeof makeBell> | null>(null);
  const suggestionRef = useRef(90);
  const styleRef = useRef<TimerStyle>("up");
  const autoDismiss = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRef = useRef<() => void>(() => {});

  const persist = (data: PersistedRest | null) => {
    try {
      if (data === null) localStorage.removeItem(PERSIST_KEY);
      else localStorage.setItem(PERSIST_KEY, JSON.stringify(data));
    } catch {
      // private mode
    }
  };

  const stop = useCallback(() => {
    if (interval.current) clearInterval(interval.current);
    if (autoDismiss.current) clearTimeout(autoDismiss.current);
    interval.current = null;
    autoDismiss.current = null;
    setRunning(false);
    setOverdue(false);
    persist(null);
  }, []);

  // tick needs stop for countdown auto-dismiss; keep the latest via ref.
  const tick = useCallback(() => {
    const secs = Math.max(0, Math.floor((Date.now() - startTs.current) / 1000));
    setElapsed(secs);
    if (secs >= suggestionRef.current && !rung.current) {
      // Suggested rest reached — ring once, keep counting.
      if (styleRef.current === "up") {
        // SL ladder: bell now, then count on toward the next marker. A big
        // jump (backgrounded tab) skips missed markers with a single bell.
        let next = nextLadderStep(suggestionRef.current);
        while (next !== undefined && secs >= next) next = nextLadderStep(next);
        if (next !== undefined) {
          suggestionRef.current = next;
          setSuggestion(next);
        } else {
          rung.current = true;
          setOverdue(true);
        }
      } else {
        rung.current = true;
        setOverdue(true);
      }
      persist({
        startTs: startTs.current,
        suggestion: suggestionRef.current,
        rung: rung.current,
        style: styleRef.current,
      });
      // Strong-style countdown ends at zero: hold a short GO moment, then
      // dismiss itself. The SL-style stopwatch keeps counting.
      if (styleRef.current === "down") {
        if (autoDismiss.current) clearTimeout(autoDismiss.current);
        autoDismiss.current = setTimeout(stopRef.current, 2500);
      }
      bell.current?.ring();
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.([200, 100, 200]);
      }
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        document.visibilityState !== "visible"
      ) {
        try {
          new Notification("Rest over", { body: "Next set.", tag: "liftlog-rest" });
        } catch {
          // notification constructor unavailable (some Android webviews)
        }
      }
    }
  }, []);

  /** A set was logged: restart the timer with this rest suggestion.
   * "up" = SL stopwatch (default); "down" = Strong countdown. */
  const start = useCallback(
    (suggestSeconds: number, timerStyle: TimerStyle = "up") => {
      if (suggestSeconds <= 0) return;
      // Called from the set tap — a user gesture, so audio may initialize
      // and notification permission may be requested.
      bell.current = bell.current ?? makeBell();
      bell.current.prime();
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission().catch(() => {});
      }
      if (interval.current) clearInterval(interval.current);
      if (autoDismiss.current) clearTimeout(autoDismiss.current);
      startTs.current = Date.now();
      suggestionRef.current = suggestSeconds;
      styleRef.current = timerStyle;
      rung.current = false;
      setSuggestion(suggestSeconds);
      setStyle(timerStyle);
      setElapsed(0);
      setOverdue(false);
      setRunning(true);
      interval.current = setInterval(tick, 1000);
      persist({
        startTs: startTs.current,
        suggestion: suggestSeconds,
        rung: false,
        style: timerStyle,
      });
    },
    [tick],
  );
  stopRef.current = stop;

  // A rest started before a refresh/navigation is still the current rest —
  // resume it with correct elapsed time. Already-rung rests don't re-ring.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as PersistedRest;
      const secs = Math.floor((Date.now() - saved.startTs) / 1000);
      // A rest older than 30 minutes is a stale artifact, not a rest.
      if (secs < 0 || secs > 30 * 60) {
        localStorage.removeItem(PERSIST_KEY);
        return;
      }
      const savedStyle: TimerStyle = saved.style === "down" ? "down" : "up";
      // An expired countdown is over — don't resurrect it.
      if (savedStyle === "down" && secs >= saved.suggestion) {
        localStorage.removeItem(PERSIST_KEY);
        return;
      }
      // A resumed stopwatch may have sailed past markers while away — fast
      // forward the ladder silently (never re-ring stale milestones).
      let target = saved.suggestion;
      if (savedStyle === "up") {
        while (secs >= target) {
          const next = nextLadderStep(target);
          if (next === undefined) break;
          target = next;
        }
      }
      startTs.current = saved.startTs;
      suggestionRef.current = target;
      styleRef.current = savedStyle;
      rung.current = saved.rung || secs >= target; // never re-ring stale
      setSuggestion(target);
      setStyle(savedStyle);
      setElapsed(secs);
      setOverdue(secs >= target);
      setRunning(true);
      interval.current = setInterval(tick, 1000);
    } catch {
      // corrupted — ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-sync immediately when the app returns to the foreground.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && interval.current) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [tick]);

  // Unmount clears the interval but NOT the persisted rest — navigating
  // away must not cancel it.
  useEffect(
    () => () => {
      if (interval.current) clearInterval(interval.current);
    },
    [],
  );

  const remaining = Math.max(0, suggestion - elapsed);
  return { running, elapsed, remaining, suggestion, overdue, style, start, stop };
}

export function RestTimerBar({
  running,
  elapsed,
  remaining,
  suggestion,
  overdue,
  style = "up",
  onDismiss,
}: {
  running: boolean;
  elapsed: number;
  remaining: number;
  suggestion: number;
  overdue: boolean;
  style?: TimerStyle;
  onDismiss: () => void;
}) {
  const shown = style === "down" ? remaining : elapsed;
  const m = Math.floor(shown / 60);
  const s = String(shown % 60).padStart(2, "0");
  const progress = suggestion > 0 ? Math.min(elapsed / suggestion, 1) : 0;

  return (
    <div
      // Announce state changes only; the ticking numbers are aria-hidden.
      role="status"
      aria-label={running ? `Resting — suggested ${suggestion} seconds` : undefined}
      aria-hidden={!running}
      className={`glass-strong fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),14px)] z-50 mx-auto flex max-w-md items-center gap-3.5 rounded-[30px] py-2.5 pl-3 pr-2.5 ${
        overdue ? "rest-over" : ""
      } ${
        running
          ? "visible translate-y-0 [transition:translate_630ms_var(--spring-sheet)]"
          : "pointer-events-none invisible translate-y-[140%] [transition:translate_300ms_ease-in,visibility_0s_300ms]"
      }`}
    >
      <svg className="h-12 w-12 flex-none -rotate-90" viewBox="0 0 44 44" aria-hidden>
        <circle cx="22" cy="22" r="18" fill="none" strokeWidth="4.5" stroke="var(--fill)" />
        <circle
          cx="22"
          cy="22"
          r="18"
          fill="none"
          strokeWidth="4.5"
          strokeLinecap="round"
          stroke={overdue ? "var(--plate-10)" : "var(--accent)"}
          strokeDasharray={DASH}
          strokeDashoffset={DASH * (1 - progress)}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      <div className="flex-1" aria-hidden>
        {/* Big, rounded digits: readable from the bench at arm's length. */}
        <div className={`rounded-num text-[30px] leading-[34px] ${overdue ? "text-success" : ""}`}>
          {overdue && style === "down" ? "Go" : `${m}:${s}`}
        </div>
        <div className="text-[13px] text-ink-dim">
          {overdue
            ? "Time for your next set"
            : style === "down"
              ? "Rest before your next set"
              : `Resting · bell at ${fmt(suggestion)}`}
        </div>
      </div>
      <button
        onClick={onDismiss}
        tabIndex={running ? 0 : -1}
        className="min-h-[44px] rounded-full bg-fill px-4 text-[15px] font-semibold text-ink"
      >
        Dismiss
      </button>
    </div>
  );
}

function fmt(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s ? `${m}:${String(s).padStart(2, "0")}` : `${m}:00`;
}
