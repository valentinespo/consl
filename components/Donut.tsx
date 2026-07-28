"use client";

import { useMoney } from "@/components/CurrencyProvider";

// One blue ramp, darkest → lightest. Biggest slice (sorted first) gets the darkest, deepest blue.
export const BLUES = ["#1e3a8a", "#1d4ed8", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe"];

export type Slice = { label: string; value: number };

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

/**
 * A donut of value slices: separated, round-capped segments with the share printed on the larger
 * ones, and a live centre that shows the total (or the focused slice on hover). Sync `hover` with a
 * legend outside so hovering either highlights both.
 */
export function Donut({
  data,
  palette = BLUES,
  hover,
  onHover,
}: {
  data: Slice[];
  palette?: string[];
  hover: number | null;
  onHover: (i: number | null) => void;
}) {
  const { money } = useMoney();
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const C = 65;
  const R = 46;
  const SW = 17;
  // Gap between slices — larger when there are fewer of them, so the ring always looks intentional.
  const GAP = data.length > 1 ? Math.min(0.13, 0.55 / data.length) : 0;

  let angle = -Math.PI / 2;
  const segs = data.map((d, i) => {
    const frac = d.value / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const g = Math.min(GAP, (a1 - a0) * 0.4); // never eat a thin slice entirely
    const s1 = Math.max(a0 + g + 0.0001, a1 - g);
    const mid = (a0 + a1) / 2;
    return { ...d, i, color: palette[i % palette.length], d: arc(C, C, R, a0 + g, s1), pct: frac * 100, mid };
  });
  const focus = hover != null ? segs[hover] : null;
  const dim = (i: number) => (hover == null || hover === i ? 1 : 0.3);

  return (
    <svg viewBox="0 0 130 130" className="mx-auto h-[132px] w-[132px]" role="img">
      {segs.map((s) => (
        <path
          key={s.label}
          d={s.d}
          fill="none"
          stroke={s.color}
          strokeWidth={hover === s.i ? SW + 4 : SW}
          strokeLinecap="round"
          style={{ opacity: dim(s.i), transition: "opacity .15s, stroke-width .15s", cursor: "pointer" }}
          onMouseEnter={() => onHover(s.i)}
          onMouseLeave={() => onHover(null)}
        />
      ))}
      {/* Share printed on slices with room for it. */}
      {segs
        .filter((s) => s.pct >= 8)
        .map((s) => (
          <text
            key={`t-${s.label}`}
            x={C + R * Math.cos(s.mid)}
            y={C + R * Math.sin(s.mid)}
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontSize: 7.5, fontWeight: 700, fill: "#fff", pointerEvents: "none", opacity: dim(s.i) }}
          >
            {Math.round(s.pct)}%
          </text>
        ))}
      <text x={C} y={C - 5} textAnchor="middle" className="fill-muted" style={{ fontSize: 7.5, letterSpacing: 0.5, pointerEvents: "none" }}>
        {focus ? focus.label.toUpperCase().slice(0, 14) : "TOTAL"}
      </text>
      <text x={C} y={C + 8} textAnchor="middle" className="fill-ink" style={{ fontSize: 13, fontWeight: 600, pointerEvents: "none" }}>
        {money(focus ? focus.value : total).replace(/\.\d+$/, "")}
      </text>
      {focus && (
        <text x={C} y={C + 20} textAnchor="middle" className="fill-muted" style={{ fontSize: 8.5, pointerEvents: "none" }}>
          {focus.pct.toFixed(1)}%
        </text>
      )}
    </svg>
  );
}
