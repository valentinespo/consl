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

  // Give every non-zero slice a minimum drawable span so a near-zero one (e.g. $50 of $300k)
  // still shows, with a gap on each side, instead of collapsing to nothing or being swallowed
  // by a huge neighbour's rounding. The extra angle is borrowed proportionally from the big
  // slices; the printed % labels keep each slice's TRUE share. A slice this small is drawn as a
  // fully round-ended pill (see NUB) rather than a wedge — a squared-off sliver looks broken.
  const MIN = 0.2; // ~11°: room for the pill plus a gap each side
  const NUB = 6; // pill width for a sub-MIN slice, in viewBox px — round caps top and bottom
  const raw = data.map((d) => (d.value / total) * TWO_PI);
  let deficit = 0;
  let big = 0;
  raw.forEach((s) => {
    if (s > 0 && s < MIN) deficit += MIN - s;
    else if (s >= MIN) big += s;
  });
  const scale = big > 0 ? Math.max(0, big - deficit) / big : 1;
  const spans = raw.map((s) => (s <= 0 ? 0 : s < MIN ? MIN : s * scale));

  let angle = -Math.PI / 2;
  const segs = data.map((d, i) => {
    const a0 = angle;
    // A lone full-circle slice can't be one arc; shave a hair off so the path stays drawable.
    const span = Math.min(spans[i], TWO_PI * 0.9999);
    const a1 = a0 + span;
    angle = a1;
    const mid = (a0 + a1) / 2;
    // Sub-MIN slices had to be bumped to the floor: draw them as a round-capped radial pill
    // (a capsule spanning the ring) so both ends are fully rounded, not a straight-topped sliver.
    const tiny = raw[i] > 0 && raw[i] < MIN;
    const r0 = IR + NUB / 2;
    const r1 = R - NUB / 2;
    const pill = tiny
      ? { x1: C + r0 * Math.cos(mid), y1: C + r0 * Math.sin(mid), x2: C + r1 * Math.cos(mid), y2: C + r1 * Math.sin(mid) }
      : null;
    // Corner rounding shrinks for narrow wedges so a thin one can't balloon past its share.
    const cr = Math.max(0.6, Math.min(CR, (span * (IR + CR) - GAP) / 2 - 0.2));
    return { ...d, i, color: palette[i % palette.length], pct: (d.value / total) * 100, mid, pill, d: tiny ? "" : sector(a0, a1, cr), cr };
  });
  const dim = (i: number) => (hover == null || hover === i ? 1 : 0.35);
  const labelRad = (R + IR) / 2;

  return (
    <svg viewBox="0 0 140 140" preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img">
      {segs.map((s) =>
        s.pill ? (
          <line
            key={s.label}
            x1={s.pill.x1}
            y1={s.pill.y1}
            x2={s.pill.x2}
            y2={s.pill.y2}
            stroke={s.color}
            strokeWidth={NUB}
            strokeLinecap="round"
            style={{ opacity: dim(s.i), transition: "opacity .15s", cursor: "pointer" }}
            onMouseEnter={() => onHover(s.i)}
            onMouseLeave={() => onHover(null)}
          />
        ) : (
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
        ),
      )}
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
