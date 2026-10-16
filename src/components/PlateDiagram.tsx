"use client";

/** Barbell loading diagram — one sleeve, side-on, loaded the way it is in the
 * gym: plates hard against the shoulder, collar last.
 *
 * Fixed scale on purpose. A viewBox fitted to the load rescaled the whole bar
 * on every ±2.5 tap — a light load ballooned, a heavy one shrank — so the
 * plates never looked the same size twice. Here a 20 is always a 20, and a
 * changed plate slides on (or off) the sleeve instead. */

import { useId } from "react";
import { platesPerSide, PLATE_COLORS } from "@/lib/plates";
import { useGymPlates } from "@/lib/gymPlates";

/** Side-on plate profile. Bumpers 10–25kg share one diameter (450mm) and
 * differ in thickness; change plates are smaller discs. */
const PLATE_SIZE: Record<number, { w: number; h: number }> = {
  25: { w: 26, h: 104 },
  20: { w: 22, h: 104 },
  15: { w: 18, h: 104 },
  10: { w: 14, h: 104 },
  5: { w: 11, h: 66 },
  2.5: { w: 9, h: 52 },
  1.25: { w: 7, h: 42 },
};

const H = 116;
const MID = H / 2;
const SHOULDER_X = 34;
const LOAD_X = SHOULDER_X + 12; // first plate sits hard against the shoulder
/** Wide enough for ~200kg; heavier loads extend it rather than shrink it. */
const MIN_W = 300;

export function PlateDiagram({
  totalKg,
  barKg = 20,
}: {
  totalKg: number;
  barKg?: number;
}) {
  const uid = useId();
  const sheenId = `sheen-${uid}`;
  const steelId = `steel-${uid}`;
  const fadeId = `fade-${uid}`;

  const plates = platesPerSide(totalKg, barKg, useGymPlates());
  const perSide = (totalKg - barKg) / 2;

  let x = LOAD_X;
  const placed = (plates ?? []).map((p, i) => {
    const size = PLATE_SIZE[p] ?? { w: 8, h: 40 };
    const at = x;
    x += size.w + 2;
    return { p, i, at, ...size };
  });
  const collarX = x + 1;
  const width = Math.max(MIN_W, collarX + 40);

  return (
    <figure className="mx-auto w-full max-w-[340px]">
      <svg
        viewBox={`0 0 ${width} ${H}`}
        className="mx-auto block h-auto w-full"
        role="img"
        aria-label={
          plates && plates.length > 0
            ? `${totalKg}kg: ${plates.join(", ")} per side on a ${barKg}kg bar`
            : plates
              ? `Empty ${barKg}kg bar`
              : `${totalKg}kg is not loadable with standard plates`
        }
      >
        <defs>
          {/* Light from above: a lit top edge, a shaded underside. */}
          <linearGradient id={sheenId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
            <stop offset="0.18" stopColor="#fff" stopOpacity="0.08" />
            <stop offset="0.6" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.32" />
          </linearGradient>
          <linearGradient id={steelId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d1d1d6" />
            <stop offset="0.45" stopColor="#8e8e93" />
            <stop offset="1" stopColor="#48484a" />
          </linearGradient>
          {/* The shaft runs off toward the lifter's hands. */}
          <linearGradient id={fadeId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#8e8e93" stopOpacity="0" />
            <stop offset="1" stopColor="#8e8e93" stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* shaft, shoulder, sleeve */}
        <rect x="0" y={MID - 3.5} width={SHOULDER_X} height="7" fill={`url(#${fadeId})`} />
        <rect x={SHOULDER_X} y={MID - 15} width="9" height="30" rx="2.5" fill={`url(#${steelId})`} />
        <rect
          x={SHOULDER_X + 9}
          y={MID - 7}
          width={width - SHOULDER_X - 13}
          height="14"
          rx="4"
          fill={`url(#${steelId})`}
        />

        {placed.map(({ p, i, at, w, h }) => (
          // Keyed by slot + denomination: only a plate that actually changed
          // replays its slide-on.
          <g
            key={`${i}-${p}`}
            className="plate-on"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <rect
              x={at}
              y={MID - h / 2}
              width={w}
              height={h}
              rx={Math.min(4, w / 2)}
              fill={PLATE_COLORS[p] ?? "#8e8e93"}
            />
            <rect
              x={at}
              y={MID - h / 2}
              width={w}
              height={h}
              rx={Math.min(4, w / 2)}
              fill={`url(#${sheenId})`}
            />
            {/* rubber lip where the bumper meets the hub */}
            <rect x={at} y={MID - 9} width={w} height="18" fill="rgba(0,0,0,0.28)" />
          </g>
        ))}

        {plates && plates.length > 0 && (
          <rect
            key={`collar-${plates.length}`}
            className="plate-on"
            style={{ animationDelay: `${plates.length * 40}ms` }}
            x={collarX}
            y={MID - 12}
            width="9"
            height="24"
            rx="2.5"
            fill={`url(#${steelId})`}
          />
        )}
      </svg>

      <figcaption className="mt-2 text-center text-[13px] text-ink-dim">
        {plates === null ? (
          <>Can’t be made with standard plates</>
        ) : plates.length === 0 ? (
          <>Empty bar · {barKg}kg</>
        ) : (
          <>
            <span className="flex flex-wrap items-center justify-center gap-1.5">
              <span className="text-ink-faint">Each side</span>
              {groupPlates(plates).map(({ p, n }) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1 rounded-full bg-fill py-0.5 pl-1 pr-2 text-[12.5px] font-semibold text-ink"
                >
                  <span
                    aria-hidden
                    className="h-3 w-3 rounded-full ring-1 ring-black/20"
                    style={{ background: PLATE_COLORS[p] }}
                  />
                  {n > 1 ? `${n} × ${p}` : p}
                </span>
              ))}
            </span>
            <span className="mono mt-1.5 block">
              Bar {barKg} + 2 × {perSide} ={" "}
              <span className="font-semibold text-ink">{totalKg}kg</span>
            </span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

/** [20, 20, 5] → [{20 ×2}, {5 ×1}], heaviest first (already sorted). */
function groupPlates(plates: number[]): { p: number; n: number }[] {
  const out: { p: number; n: number }[] = [];
  for (const p of plates) {
    const last = out.at(-1);
    if (last?.p === p) last.n++;
    else out.push({ p, n: 1 });
  }
  return out;
}
