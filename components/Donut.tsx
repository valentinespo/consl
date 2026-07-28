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
  const TWO_PI = Math.PI * 2;

  // Slices under this share are dropped from the wheel entirely (they stay in the breakdown list
  // with their real value) — a near-zero slice like $50 of $300k can't be drawn honestly at true
  // scale, and faking it in reads as broken. Every slice that IS drawn is a normal rounded wedge,
  // so they all look the same. The drawn slices are renormalised to fill the ring; their labels
  // keep the TRUE share of the grand total.
  const MIN_PCT = 0.03; // 3%
  const shown = data.map((d, i) => ({ d, i })).filter((x) => x.d.value / total >= MIN_PCT);
  const shownTotal = shown.reduce((s, x) => s + x.d.value, 0) || 1;
  const shownIdx = new Set(shown.map((x) => x.i));

  let angle = -Math.PI / 2;
  const segs = shown.map(({ d, i }) => {
    const frac = d.value / shownTotal;
    const a0 = angle;
    // A lone full-circle slice can't be one arc; shave a hair off so the path stays drawable.
    const span = Math.min(frac, 0.9999) * TWO_PI;
    const a1 = a0 + span;
    angle = a1;
    const mid = (a0 + a1) / 2;
    // Corner rounding shrinks for narrower wedges so their corners can't overlap; every drawn
    // slice is ≥3%, so this only ever eases the rounding a touch — never a pill.
    const cr = Math.max(1, Math.min(CR, (span * (IR + CR) - GAP) / 2 - 0.2));
    return { label: d.label, i, color: palette[i % palette.length], pct: (d.value / total) * 100, mid, d: sector(a0, a1, cr), cr };
  });
  // Hovering a slice that isn't drawn (a sub-3% one, from its legend row) shouldn't dim the wheel.
  const dim = (i: number) => (hover == null || !shownIdx.has(hover) || hover === i ? 1 : 0.35);
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
            style={{ fontSize: 10, fontWeight: 500, fill: "#fff", pointerEvents: "none", opacity: dim(s.i) }}
          >
            {Math.round(s.pct)}%
          </text>
        ))}
    </svg>
  );
}
