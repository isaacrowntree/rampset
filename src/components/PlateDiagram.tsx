"use client";

/** Barbell loading diagram — plates drawn in their IWF colors. */

import { platesPerSide, PLATE_COLORS } from "@/lib/plates";

const PLATE_SIZE: Record<number, { w: number; h: number }> = {
  25: { w: 26, h: 104 },
  20: { w: 26, h: 104 },
  15: { w: 24, h: 88 },
  10: { w: 22, h: 68 },
  5: { w: 18, h: 52 },
  2.5: { w: 14, h: 40 },
  1.25: { w: 11, h: 30 },
};

export function PlateDiagram({
  totalKg,
  barKg = 20,
}: {
  totalKg: number;
  barKg?: number;
}) {
  const plates = platesPerSide(totalKg, barKg);
  const perSide = (totalKg - barKg) / 2;

  let x = 78;
  const rendered = (plates ?? []).map((p, i) => {
    const size = PLATE_SIZE[p] ?? { w: 12, h: 30 };
    const el = (
      <g key={i}>
        <rect
          x={x}
          y={60 - size.h / 2}
          width={size.w}
          height={size.h}
          rx="7"
          fill={PLATE_COLORS[p] ?? "#9AA0AB"}
        />
        {size.w >= 18 && (
          <text
            x={x + size.w / 2}
            y={64}
            textAnchor="middle"
            fontSize={p >= 10 ? 12 : 9}
            fontWeight="800"
            fill={p === 5 || p === 15 ? "#1a1a1a" : "#fff"}
          >
            {p}
          </text>
        )}
      </g>
    );
    x += size.w + 5;
    return el;
  });

  return (
    <svg
      viewBox="0 0 330 120"
      className="mx-auto w-full max-w-[330px]"
      role="img"
      aria-label={
        plates
          ? `${totalKg}kg: ${plates.join(", ")} per side on a ${barKg}kg bar`
          : `${totalKg}kg is not loadable with standard plates`
      }
    >
      <rect x="0" y="55" width="330" height="10" rx="4" fill="#3A3C42" />
      <rect x="60" y="49" width="10" height="22" rx="3" fill="#4A4C52" />
      {rendered}
      <rect x={x + 2} y="51" width="13" height="18" rx="3" fill="#5C6069" />
      <text x="255" y="42" fontSize="11" fill="#9AA0AB" className="mono">
        bar {barKg}kg
      </text>
      <text x="255" y="60" fontSize="11" fill="#9AA0AB" className="mono">
        {plates ? `+ 2×${perSide}kg` : "not loadable"}
      </text>
      <text x="255" y="80" fontSize="12" fontWeight="600" fill="#F2F3F5" className="mono">
        = {totalKg}kg
      </text>
    </svg>
  );
}
