"use client";

// One violet ramp, deepest → lightest — the reference's donut language. Biggest slice (sorted
// first) gets the deepest purple; the tail fades toward lavender.
export const RAMP = ["#6d28d9", "#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"];

export type Slice = { label: string; value: number };

const C = 70; // centre
const R = 66; // outer radius
const IR = 31; // inner radius — a small hole, the reference's thick ring
const CR = 3; // corner rounding — drawn inset, then a fat round-joined stroke restores the size
const PAD = 0.13; // angular seam between slices (at the outer edge, net of the stroke expansion)

const pt = (rad: number, a: number) => `${C + rad * Math.cos(a)} ${C + rad * Math.sin(a)}`;

/** An annular wedge from a0 to a1, inset by CR — the same-colour round-joined stroke that wraps
 *  it grows it back to full size with every corner softly rounded, like the reference. */
function sector(a0: number, a1: number) {
  const ro = R - CR;
  const ri = IR + CR;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${pt(ro, a0)} A ${ro} ${ro} 0 ${large} 1 ${pt(ro, a1)} L ${pt(ri, a1)} A ${ri} ${ri} 0 ${large} 0 ${pt(ri, a0)} Z`;
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
    // Seam between slices — clamped so a sliver of a slice still draws as a dot, not nothing.
    const pad = Math.min(PAD, (a1 - a0) * 0.4);
    const s0 = a0 + pad / 2;
    const s1 = Math.max(s0 + 0.02, a1 - pad / 2);
    const mid = (a0 + a1) / 2;
    return { ...d, i, color: palette[i % palette.length], d: sector(s0, s1), pct: frac * 100, mid };
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
          stroke={s.color}
          strokeWidth={CR * 2}
          strokeLinejoin="round"
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
            style={{ fontSize: 11, fontWeight: 600, fill: "#fff", pointerEvents: "none", opacity: dim(s.i) }}
          >
            {Math.round(s.pct)}%
          </text>
        ))}
    </svg>
  );
}
