"use client";

import { useState } from "react";
import { useMoney } from "@/components/CurrencyProvider";

// Two palettes so the two donuts read as different metrics. Darkest → lightest.
export const BLUES = ["#1e3a8a", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe"];
export const VIOLETS = ["#4c1d95", "#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe"];

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

/** Donut of value-by-facility in a graded palette; hover a slice (or legend row) to focus it. */
export function FacilityPie({ data, palette = BLUES, label }: { data: { code: string; value: number }[]; palette?: string[]; label?: string }) {
  const { money } = useMoney();
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 48;
  const C = 65;
  let angle = -Math.PI / 2;
  const segs = data.map((d, i) => {
    const frac = d.value / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const end = frac >= 0.9999 ? a1 - 0.0001 : a1;
    return { ...d, i, color: palette[i % palette.length], d: arc(C, C, R, a0, end), pct: frac * 100 };
  });
  const focus = hover != null ? segs[hover] : null;

  return (
    <div className="flex flex-col items-center">
      {label && <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>}
      <svg viewBox="0 0 130 130" className="h-[124px] w-[124px]">
        {segs.map((s) => (
          <path
            key={s.code}
            d={s.d}
            fill="none"
            stroke={s.color}
            strokeWidth={hover === s.i ? 24 : 20}
            strokeLinecap="butt"
            style={{ opacity: hover == null || hover === s.i ? 1 : 0.35, transition: "opacity .15s, stroke-width .15s", cursor: "pointer" }}
            onMouseEnter={() => setHover(s.i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        <text x={C} y={C - 4} textAnchor="middle" className="fill-muted" style={{ fontSize: 8, letterSpacing: 0.5, pointerEvents: "none" }}>
          {focus ? focus.code : "TOTAL"}
        </text>
        <text x={C} y={C + 9} textAnchor="middle" className="fill-ink" style={{ fontSize: 13, fontWeight: 600, pointerEvents: "none" }}>
          {money(focus ? focus.value : total).replace(/\.\d+$/, "")}
        </text>
        {focus && (
          <text x={C} y={C + 21} textAnchor="middle" className="fill-muted" style={{ fontSize: 9, pointerEvents: "none" }}>
            {focus.pct.toFixed(1)}%
          </text>
        )}
      </svg>
      <div className="mt-3 w-full space-y-1.5">
        {segs.map((s) => (
          <div
            key={s.code}
            className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12px] transition-colors"
            style={{ background: hover === s.i ? "var(--color-surface-2)" : "transparent" }}
            onMouseEnter={() => setHover(s.i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="font-medium text-ink-soft">{s.code}</span>
            <span className="ml-auto tabular text-ink">{money(s.value)}</span>
            <span className="w-8 shrink-0 text-right tabular text-[10.5px] text-muted">{s.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
