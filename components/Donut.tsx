"use client";

// One violet ramp, deepest → lightest — the reference's donut language. Biggest slice (sorted
// first) gets the deepest purple; the tail fades toward lavender.
export const RAMP = ["#6d28d9", "#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"];

export type Slice = { label: string; value: number };

const C = 70; // centre
const R = 66; // outer radius
const IR = 31; // inner radius — a small hole, the reference's thick ring

const pt = (rad: number, a: number) => `${C + rad * Math.cos(a)} ${C + rad * Math.sin(a)}`;

/** A filled annular wedge from a0 to a1 — flat edges, like the reference. */
function sector(a0: number, a1: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${pt(R, a0)} A ${R} ${R} 0 ${large} 1 ${pt(R, a1)} L ${pt(IR, a1)} A ${IR} ${IR} 0 ${large} 0 ${pt(IR, a0)} Z`;
}

/**
 * The reference donut: thick filled wedges separated by crisp surface-coloured seams, a small
 * open hole (no centre text — totals live in the widget), and bold white share labels riding
 * the slices. Scales to whatever box its parent gives it (preserveAspectRatio keeps it round).
 * Sync `hover` with a legend outside so hovering either highlights both.
 */
export function Donut({
  data,
  palette = RAMP,
  hover,
  onHover,
}: {
  data: Slice[];
  palette?: string[];
  hover: number | null;
  onHover: (i: number | null) => void;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  let angle = -Math.PI / 2;
  const segs = data.map((d, i) => {
    const frac = d.value / total;
    const a0 = angle;
    // A full-circle slice can't be one arc; shave a hair off so the path stays drawable.
    const a1 = angle + Math.min(frac, 0.9999) * Math.PI * 2;
    angle = a0 + frac * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    return { ...d, i, color: palette[i % palette.length], d: sector(a0, a1), pct: frac * 100, mid };
  });
  const dim = (i: number) => (hover == null || hover === i ? 1 : 0.35);
  const labelRad = (R + IR) / 2;

  return (
    <svg viewBox="0 0 140 140" preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img">
      {segs.map((s) => (
        <path
          key={s.label}
          d={s.d}
          fill={s.color}
          stroke="var(--color-surface)"
          strokeWidth={3}
          style={{ opacity: dim(s.i), transition: "opacity .15s", cursor: "pointer" }}
          onMouseEnter={() => onHover(s.i)}
          onMouseLeave={() => onHover(null)}
        />
      ))}
      {/* Share printed on slices with room for it — bold, white, reference-sized. */}
      {segs
        .filter((s) => s.pct >= 6)
        .map((s) => (
          <text
            key={`t-${s.label}`}
            x={C + labelRad * Math.cos(s.mid)}
            y={C + labelRad * Math.sin(s.mid)}
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fontSize: 11, fontWeight: 700, fill: "#fff", pointerEvents: "none", opacity: dim(s.i) }}
          >
            {Math.round(s.pct)}%
          </text>
        ))}
    </svg>
  );
}
