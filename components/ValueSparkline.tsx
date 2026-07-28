"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMoney } from "@/components/CurrencyProvider";
import { compactMoney, niceTicks } from "@/lib/chart";

const W = 1000;
const H = 150;
const TIP_W = 235; // estimate for edge-flipping; the card itself sizes to its content
const LINE = "#8b5cf6"; // violet — the chart's own voice, distinct from the app's blue accent
// Ease-in-AND-out (cubic): the markers accelerate away gently and settle softly onto the next
// point instead of snapping.
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)";
const GLIDE = "transform 0.32s " + EASE;

/** Smooth (cardinal-spline) line + area path through points in 0..w / 0..h space. */
function spline(pts: [number, number][], w = W, h = H) {
  const n = pts.length;
  if (n === 0) return { line: "", area: "" };
  if (n === 1) {
    const [, y] = pts[0];
    return { line: `M 0 ${y} L ${w} ${y}`, area: `M 0 ${y} L ${w} ${y} L ${w} ${h} L 0 ${h} Z` };
  }
  let line = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    line += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return { line, area: `${line} L ${pts[n - 1][0]} ${h} L ${pts[0][0]} ${h} Z` };
}

/**
 * The inventory value-over-time chart, with the reference's hover feel:
 *  - the plot (area + line) fades out at both side edges, not just the bottom;
 *  - on hover the whole line softens and a full-strength segment glows around the cursor,
 *    gliding from point to point with an ease-out motion (an HTML window, gradient-masked,
 *    slides over a counter-translated copy of the line so the glow travels but the line doesn't);
 *  - the rule, dot and readout card glide the same way;
 *  - the hovered date sits in a dark pill on the axis whose label rolls — old date up and out,
 *    new date in from below.
 * Purely presentational: the card above owns the range state and hands in sliced points.
 */
export function ValueSparkline({ pts }: { pts: { day: string; total: number }[] }) {
  const { money, locale, symbol } = useMoney();
  const [hover, setHover] = useState<number | null>(null);
  // Measured on hover so markers can be placed in real pixels: the SVG is stretched with
  // preserveAspectRatio="none", so its own coordinates don't map onto the box one-to-one.
  const [plot, setPlot] = useState({ w: 0, h: 0 });
  // A new "session" per mouse-enter: animated elements are keyed by it, so the first position of
  // a fresh hover mounts in place instead of gliding in from wherever the last hover ended.
  const sessRef = useRef(0);
  const lastHover = useRef<number | null>(null);

  const n = pts.length;
  const axis = useMemo(() => {
    const vals = pts.map((p) => p.total);
    return niceTicks(Math.min(...(vals.length ? vals : [0])), Math.max(...(vals.length ? vals : [1])), 4);
  }, [pts]);

  const span = axis.hi - axis.lo || 1;
  const px = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const py = (v: number) => H - ((v - axis.lo) / span) * H;
  const { line, area } = useMemo(
    () => spline(pts.map((p, i) => [px(i), py(p.total)] as [number, number])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pts, axis],
  );

  // Axis labels every `step` days: gaps are identical AND every label sits at its day's true
  // position — so the hover rule, dot and pill land exactly on the label they name. (Even pixel
  // slots looked tidy but disagreed with the data positions; a constant day-step gives both.)
  const xTicks = useMemo(() => {
    if (n <= 1) return [{ frac: 0.5, i: 0 }];
    const want = Math.min(n, 5);
    const step = Math.max(1, Math.ceil((n - 1) / (want - 1)));
    const out: { frac: number; i: number }[] = [];
    for (let i = 0; i < n; i += step) out.push({ frac: i / (n - 1), i });
    return out;
  }, [n]);

  const dayLabel = (iso: string, withWeekday = false) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      ...(withWeekday ? { weekday: "short" } : {}),
    });

  function track(e: React.MouseEvent<HTMLDivElement>) {
    if (n === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPlot({ w: r.width, h: r.height });
    const f = (e.clientX - r.left) / (r.width || 1);
    const idx = Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))));
    if (lastHover.current === null) sessRef.current++;
    lastHover.current = idx;
    setHover(idx);
  }
  function leave() {
    lastHover.current = null;
    setHover(null);
  }

  const hp = hover != null ? pts[hover] : null;
  const hx = hover != null && plot.w ? (px(hover) / W) * plot.w : 0;
  const hy = hp && plot.h ? (py(hp.total) / H) * plot.h : 0;
  // The readout floats beside the dot, vertically centred on it, flipping sides at the right
  // edge — overlapping the line and fill so the frosted blur has something to smear.
  const tipLeft = hx + 16 + TIP_W > plot.w ? Math.max(0, hx - 16 - TIP_W) : hx + 16;
  const tipTop = Math.max(2, Math.min(hy - 34, (plot.h || 999) - 76));
  const sess = sessRef.current;

  // The glow window: about three point-spacings wide, gradient-edged so the full-strength
  // segment melts into the softened line on both sides.
  const spacingPx = n > 1 && plot.w ? plot.w / (n - 1) : 0;
  const hlW = Math.max(90, Math.min(300, spacingPx * 3));
  const hlLeft = hx - hlW / 2;

  // The dot rides the actual curve between points (CSS motion path), so a fast sweep can't cut
  // the corner across a bend the way a straight x/y transition does. Chord-length positions are
  // indistinguishable from true arc length on a spline this smooth.
  const pxPath = useMemo(() => {
    if (n < 2 || !plot.w || !plot.h) return null;
    const p2 = pts.map((p, i) => [(px(i) / W) * plot.w, (py(p.total) / H) * plot.h] as [number, number]);
    let total = 0;
    const cum = [0];
    for (let i = 1; i < p2.length; i++) {
      total += Math.hypot(p2[i][0] - p2[i - 1][0], p2[i][1] - p2[i - 1][1]);
      cum.push(total);
    }
    return { d: spline(p2, plot.w, plot.h).line, fracs: cum.map((c) => (total ? c / total : 0)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, axis, plot.w, plot.h]);
  const supportsOffset = useMemo(
    () =>
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("offset-path", "path('M 0 0 L 1 1')"),
    [],
  );

  // Rolling pill label: remember the previous date while the new one animates in.
  const [roll, setRoll] = useState<{ cur: string | null; prev: string | null; tick: number }>({
    cur: null,
    prev: null,
    tick: 0,
  });
  const day = hp?.day ?? null;
  useEffect(() => {
    if (!day) {
      setRoll({ cur: null, prev: null, tick: 0 });
      return;
    }
    setRoll((r) => (r.cur === day ? r : { cur: day, prev: r.cur, tick: r.tick + 1 }));
  }, [day]);

  if (n === 0) {
    return (
      <div className="mt-4 flex min-h-[60px] flex-1 items-center justify-center text-[11px] text-muted">
        No days recorded in this range.
      </div>
    );
  }

  const maskCss = "linear-gradient(to right, transparent, black 32%, black 68%, transparent)";

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {/* Y axis as its own column, so a long label can never sit on top of the plot. */}
        <div className="flex w-[52px] shrink-0 flex-col justify-between pr-2 text-right text-[10.5px] leading-none tabular text-ink-soft">
          {[...axis.ticks].reverse().map((t) => (
            <span key={t}>{compactMoney(t, symbol, locale)}</span>
          ))}
        </div>

        <div className="relative min-h-[40px] w-full flex-1" onMouseMove={track} onMouseLeave={leave}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
            <defs>
              <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={LINE} stopOpacity="0.30" />
                <stop offset="70%" stopColor={LINE} stopOpacity="0.06" />
                <stop offset="100%" stopColor={LINE} stopOpacity="0" />
              </linearGradient>
              {/* Side fade for the plot itself — the line and fill dissolve at both edges. */}
              <linearGradient id="spark-edge" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset="0.07" stopColor="#fff" stopOpacity="1" />
                <stop offset="0.93" stopColor="#fff" stopOpacity="1" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <mask id="spark-edge-mask" maskUnits="userSpaceOnUse" x="0" y="-10" width={W} height={H + 20}>
                <rect x="0" y="-10" width={W} height={H + 20} fill="url(#spark-edge)" />
              </mask>
              {/* Vertical fade for the gridlines — dashes thin out toward the bottom like the fill. */}
              <linearGradient id="spark-grid-v" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
                <stop offset="0.7" stopColor="#fff" stopOpacity="0.45" />
                <stop offset="1" stopColor="#fff" stopOpacity="0.12" />
              </linearGradient>
              <mask id="spark-grid-v-mask" maskUnits="userSpaceOnUse" x="0" y="-10" width={W} height={H + 20}>
                <rect x="0" y="-10" width={W} height={H + 20} fill="url(#spark-grid-v)" />
              </mask>
            </defs>
            {/* Nested masks multiply: each dash row fades at the side edges AND toward the floor. */}
            <g mask="url(#spark-edge-mask)">
              <g mask="url(#spark-grid-v-mask)">
                {axis.ticks.map((t) => (
                  <line
                    key={t}
                    x1={0}
                    x2={W}
                    y1={py(t)}
                    y2={py(t)}
                    stroke="var(--color-border)"
                    strokeWidth={1}
                    strokeDasharray="3 6"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            </g>
            <g mask="url(#spark-edge-mask)">
              <path d={area} fill="url(#spark-fill)" />
              <path
                d={line}
                fill="none"
                stroke={LINE}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                style={{ opacity: hp ? 0.32 : 1, transition: "opacity 0.2s ease" }}
              />
            </g>
          </svg>

          {/* The gliding glow: a full-strength copy of the line that NEVER moves, revealed through
              a gradient mask window that slides to the cursor. One animated property on one static
              element — the glow physically cannot drift off the line, however fast the cursor. */}
          {hp && plot.w > 0 && (
            <svg
              key={`hl${sess}`}
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{
                WebkitMaskImage: maskCss,
                maskImage: maskCss,
                WebkitMaskSize: `${hlW}px 100%`,
                maskSize: `${hlW}px 100%`,
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: `${hlLeft}px 0`,
                maskPosition: `${hlLeft}px 0`,
                transition: `mask-position 0.32s ${EASE}, -webkit-mask-position 0.32s ${EASE}`,
              }}
            >
              <path
                d={line}
                fill="none"
                stroke={LINE}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}

          {/* Marker and readout in pixels rather than SVG units, so the stretch can't skew them. */}
          {hp && plot.w > 0 && (
            <>
              <div
                key={`rule${sess}`}
                className="pointer-events-none absolute bottom-0 top-0 w-px"
                style={{ left: 0, transform: `translateX(${hx}px)`, transition: GLIDE, background: LINE, opacity: 0.85 }}
              />
              {pxPath && supportsOffset && hover != null ? (
                <div
                  key={`dot${sess}`}
                  className="pointer-events-none absolute left-0 top-0 h-[10px] w-[10px] rounded-full border-2 border-white"
                  style={{
                    background: LINE,
                    offsetPath: `path("${pxPath.d}")`,
                    offsetRotate: "0deg",
                    offsetDistance: `${(pxPath.fracs[hover] * 100).toFixed(3)}%`,
                    transition: `offset-distance 0.32s ${EASE}`,
                  }}
                />
              ) : (
                <div
                  key={`dot${sess}`}
                  className="pointer-events-none absolute left-0 top-0 h-[10px] w-[10px] rounded-full border-2 border-white"
                  style={{
                    background: LINE,
                    transform: `translate(calc(${hx}px - 50%), calc(${hy}px - 50%))`,
                    transition: GLIDE,
                  }}
                />
              )}
              <div
                key={`tip${sess}`}
                className="tip-frost pointer-events-none absolute left-0 top-0 z-20 rounded-2xl px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.14)]"
                style={{ transform: `translate(${tipLeft}px, ${tipTop}px)`, transition: GLIDE }}
              >
                <div className="whitespace-nowrap text-[13px] font-semibold text-ink">{dayLabel(hp.day, true)}</div>
                <div className="mt-1.5 flex items-center whitespace-nowrap">
                  <span className="mr-2.5 h-2.5 w-2.5 rounded-full" style={{ background: LINE }} />
                  <span className="text-[12.5px] text-ink-soft">Total</span>
                  <span className="ml-5 text-[14px] tabular font-semibold text-ink">{money(hp.total)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* X axis, offset to start where the plot starts so ticks sit under the points they name.
          The hovered day gets the dark pill; its label rolls as the date changes. */}
      <div className="relative ml-[52px] mt-2 h-[20px] text-[10.5px] leading-none text-ink-soft">
        {xTicks.map(({ frac, i }) => (
          <span
            key={i}
            className="absolute top-[5px] whitespace-nowrap"
            style={{
              left: `${frac * 100}%`,
              transform: frac === 0 ? "none" : frac === 1 ? "translateX(-100%)" : "translateX(-50%)",
            }}
          >
            {dayLabel(pts[i].day)}
          </span>
        ))}
        {roll.cur && hp && plot.w > 0 && (
          <span
            key={`pill${sess}`}
            className="absolute left-0 top-0 z-10 inline-flex rounded-full bg-ink px-2.5 py-[4px] text-[10.5px] font-medium text-bg"
            style={{
              // Centred exactly on the rule — the pill and the line always agree.
              transform: `translateX(calc(${hx}px - 50%))`,
              transition: GLIDE,
            }}
          >
            <span className="relative block h-[13px] overflow-hidden leading-[13px]">
              {/* Invisible copy sizes the pill; the visible copies roll through it. */}
              <span className="invisible whitespace-nowrap">{dayLabel(roll.cur)}</span>
              <span key={`c${roll.tick}`} className="roll-in absolute inset-0 whitespace-nowrap text-center">
                {dayLabel(roll.cur)}
              </span>
              {roll.prev && (
                <span key={`p${roll.tick}`} className="roll-out absolute inset-0 whitespace-nowrap text-center">
                  {dayLabel(roll.prev)}
                </span>
              )}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
