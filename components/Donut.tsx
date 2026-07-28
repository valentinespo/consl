"use client";

// One violet ramp, deepest → lightest — the reference's donut language. Biggest slice (sorted
// first) gets the deepest purple; the tail fades toward lavender.
export const RAMP = ["#6d28d9", "#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"];

export type Slice = { label: string; value: number };

const C = 70; // centre
const R = 66; // outer radius
const IR = 31; // inner radius — a small hole, the reference's thick ring
const CR = 3; // corner rounding — drawn inset, then a fat round-joined stroke restores the size
const GAP = 2.6; // seam between slices, in viewBox px — constant width from hole to rim

const pt = (rad: number, a: number) => `${C + rad * Math.cos(a)} ${C + rad * Math.sin(a)}`;

/** An annular wedge from a0 to a1, inset by `cr` on every side plus half the seam — the
 *  same-colour round-joined stroke that wraps it grows it back so every corner rounds softly
 *  and the visible edge lands exactly GAP/2 from the slice boundary. The seam is a constant
 *  pixel width, so each arc gets its own angular inset (wider near the hole than at the rim);
 *  that keeps neighbouring edges parallel instead of pinching shut at the centre. */
function sector(a0: number, a1: number, cr: number) {
  const ro = R - cr;
  const ri = IR + cr;
  const io = (GAP / 2 + cr) / ro;
  const ii = (GAP / 2 + cr) / ri;
  const o0 = a0 + io;
  const o1 = Math.max(o0 + 0.01, a1 - io);
  const i0 = a0 + ii;
  const i1 = Math.max(i0 + 0.01, a1 - ii);
  const lo = o1 - o0 > Math.PI ? 1 : 0;
  const li = i1 - i0 > Math.PI ? 1 : 0;
  return `M ${pt(ro, o0)} A ${ro} ${ro} 0 ${lo} 1 ${pt(ro, o1)} L ${pt(ri, i1)} A ${ri} ${ri} 0 ${li} 0 ${pt(ri, i0)} Z`;
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
    // Corner rounding shrinks for sliver slices: the fat stroke that rounds a big wedge would
    // balloon a tiny one past its real share, so it scales down until the slice (plus its seam)
    // fits inside its own angle — a hairline sliver stays a hairline.
    const span = a1 - a0;
    const cr = Math.max(0.6, Math.min(CR, (span * (IR + CR) - GAP) / 2 - 0.2));
    const mid = (a0 + a1) / 2;
    return { ...d, i, color: palette[i % palette.length], d: sector(a0, a1, cr), cr, pct: frac * 100, mid };
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
          strokeWidth={s.cr * 2}
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
