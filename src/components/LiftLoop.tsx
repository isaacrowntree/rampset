"use client";

/** A line-drawn lifter looping one rep of the day's signature lift, side-on,
 * so the bar reads end-on as a single plate disc in the load's color.
 *
 * Poses morph with SMIL <animate> on each limb's path — every pose path has
 * the same commands, so the browser interpolates joint by joint. Reduced
 * motion pauses it on the lockout frame. */

import { useEffect, useRef } from "react";

export type LiftKind = "bench" | "deadlift" | "squat";

type Pt = [number, number];
interface Pose {
  /** ankle → knee → hip */
  leg: [Pt, Pt, Pt];
  /** hip → shoulder */
  torso: [Pt, Pt];
  /** shoulder → elbow → hand */
  arm: [Pt, Pt, Pt];
  head: Pt;
  /** Centre of the plate disc (the bar, end-on). */
  bar: Pt;
}

/** Two poses per lift: [start, other end]. Coordinates on a 200×110 stage,
 * floor at y=100, lifter facing right. */
const POSES: Record<LiftKind, [Pose, Pose]> = {
  // Pull from the floor to lockout. Bar over mid-foot the whole way.
  deadlift: [
    {
      leg: [[96, 100], [105, 82], [82, 61]],
      torso: [[82, 61], [108, 44]],
      arm: [[108, 44], [105, 66], [100, 89]],
      head: [117, 36],
      bar: [100, 89],
    },
    {
      leg: [[96, 100], [99, 79], [96, 58]],
      torso: [[96, 58], [99, 30]],
      arm: [[99, 30], [100, 46], [100, 60]],
      head: [101, 19],
      bar: [100, 60],
    },
  ],
  // Lying on the bench, feet planted: lockout to the chest. Legs stay put.
  bench: [
    {
      leg: [[56, 100], [62, 56], [80, 63]],
      torso: [[80, 63], [124, 63]],
      arm: [[124, 63], [124, 46], [124, 28]],
      head: [137, 60],
      bar: [124, 28],
    },
    {
      leg: [[56, 100], [62, 56], [80, 63]],
      torso: [[80, 63], [124, 63]],
      arm: [[124, 63], [113, 66], [121, 51]],
      head: [137, 60],
      bar: [121, 51],
    },
  ],
  // Bar on the back: standing to below parallel.
  squat: [
    {
      leg: [[98, 100], [100, 79], [97, 57]],
      torso: [[97, 57], [100, 30]],
      arm: [[100, 30], [90, 38], [94, 35]],
      head: [104, 18],
      bar: [94, 35],
    },
    {
      leg: [[98, 100], [113, 84], [86, 82]],
      torso: [[86, 82], [101, 56]],
      arm: [[101, 56], [91, 64], [95, 61]],
      head: [109, 45],
      bar: [95, 61],
    },
  ],
};

/** keyTimes/keySplines per lift: deadlift pulls, holds, lowers, rests;
 * bench lowers slowly and presses fast; squat sits and drives. */
const TIMING: Record<LiftKind, { dur: string; keyTimes: string; splines: string; order: (0 | 1)[] }> = {
  deadlift: {
    dur: "3.2s",
    keyTimes: "0;0.32;0.5;0.82;1",
    splines: "0.45 0 0.25 1;0 0 1 1;0.45 0 0.55 1;0 0 1 1",
    order: [0, 1, 1, 0, 0],
  },
  bench: {
    dur: "3s",
    keyTimes: "0;0.45;0.72;1",
    splines: "0.4 0 0.6 1;0.3 0 0.2 1;0 0 1 1",
    order: [0, 1, 0, 0],
  },
  squat: {
    dur: "3s",
    keyTimes: "0;0.42;0.72;1",
    splines: "0.4 0 0.6 1;0.3 0 0.2 1;0 0 1 1",
    order: [0, 1, 0, 0],
  },
};

const poly = (pts: Pt[]) => `M${pts.map(([x, y]) => `${x} ${y}`).join(" L")}`;

export function LiftLoop({ kind, plateColor }: { kind: LiftKind; plateColor: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [a, b] = POSES[kind];
  const t = TIMING[kind];
  const seq = <T,>(pick: (p: Pose) => T, fmt: (v: T) => string) =>
    t.order.map((i) => fmt(pick(i === 0 ? a : b))).join(";");

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    svg.pauseAnimations?.();
    svg.setCurrentTime?.(0);
  }, []);

  const anim = (attr: string, values: string) => (
    <animate
      attributeName={attr}
      values={values}
      dur={t.dur}
      keyTimes={t.keyTimes}
      calcMode="spline"
      keySplines={t.splines}
      repeatCount="indefinite"
    />
  );

  return (
    <svg
      ref={svgRef}
      viewBox="40 10 120 94"
      className="mx-auto block h-[110px] w-full max-w-[170px]"
      aria-hidden
    >
      {/* floor */}
      <line x1="44" y1="100.5" x2="156" y2="100.5" stroke="var(--line)" strokeWidth="1.5" strokeLinecap="round" />

      {kind === "bench" && (
        <g stroke="var(--surface-3)" strokeWidth="5" strokeLinecap="round">
          <line x1="72" y1="69" x2="140" y2="69" />
          <line x1="80" y1="70" x2="80" y2="100" />
          <line x1="132" y1="70" x2="132" y2="100" />
        </g>
      )}

      <g
        fill="none"
        stroke="var(--ink-dim)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={poly(a.leg)}>{anim("d", seq((p) => p.leg, poly))}</path>
        <path d={poly(a.torso)}>{anim("d", seq((p) => p.torso, poly))}</path>
        <path d={poly(a.arm)}>{anim("d", seq((p) => p.arm, poly))}</path>
      </g>
      <circle r="7.5" cx={a.head[0]} cy={a.head[1]} fill="var(--ink-dim)">
        {anim("cx", seq((p) => p.head[0], String))}
        {anim("cy", seq((p) => p.head[1], String))}
      </circle>

      {/* the bar, end-on: a plate disc with its hub */}
      <g>
        <circle r="11" cx={a.bar[0]} cy={a.bar[1]} fill={plateColor}>
          {anim("cx", seq((p) => p.bar[0], String))}
          {anim("cy", seq((p) => p.bar[1], String))}
        </circle>
        <circle r="11" cx={a.bar[0]} cy={a.bar[1]} fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth="1.8">
          {anim("cx", seq((p) => p.bar[0], String))}
          {anim("cy", seq((p) => p.bar[1], String))}
        </circle>
        <circle r="3" cx={a.bar[0]} cy={a.bar[1]} fill="#d1d1d6">
          {anim("cx", seq((p) => p.bar[0], String))}
          {anim("cy", seq((p) => p.bar[1], String))}
        </circle>
      </g>
    </svg>
  );
}

const PATTERN: Record<LiftKind, RegExp> = {
  bench: /bench/i,
  deadlift: /deadlift/i,
  squat: /squat/i,
};

/** The day's signature lifts, side by side: bench and squat on A-days, squat
 * and deadlift on B-days, squat alone when neither is there. */
export function signatureLifts(exerciseNames: string[]): LiftKind[] {
  const has = (k: LiftKind) => exerciseNames.some((n) => PATTERN[k].test(n));
  if (has("bench")) return has("squat") ? ["bench", "squat"] : ["bench"];
  if (has("deadlift")) return has("squat") ? ["squat", "deadlift"] : ["deadlift"];
  return ["squat"];
}

/** Which exercise name a loop stands for (to color its disc by load). */
export function matchesLift(kind: LiftKind, exerciseName: string): boolean {
  return PATTERN[kind].test(exerciseName);
}
