"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMoney } from "@/components/CurrencyProvider";
import { compactMoney, niceTicks } from "@/lib/chart";

const W = 1000;
const H = 150;
const TIP_W = 210; // estimate for edge-flipping; the card itself sizes to its content
const LINE = "#8b5cf6"; // violet — the chart's own voice, distinct from the app's blue accent
const EASE = "cubic-bezier(0.16, 0.84, 0.44, 1)"; // ease-out glide for everything that follows the cursor
const GLIDE = "transform 0.3s " + EASE;

/** Smooth (cardinal-spline) line + area path through points already in 0..W / 0..H space. */
function spline(pts: [number, number][]) {
  const n = pts.length;
  if (n === 0) return { line: "", area: "" };
  if (n === 1) {
    const [, y] = pts[0];
    return { line: `M 0 ${y} L ${W} ${y}`, area: `M 0 ${y} L ${W} ${y} L ${W} ${H} L 0 ${H} Z` };
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
  return { line, area: `${line} L ${pts[n - 1][0]} ${H} L ${pts[0][0]} ${H} Z` };
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

  // Enough labels to read the axis, few enough not to collide on a narrow widget.
  const xLabelIdx = useMemo(() => {
    if (n <= 1) return [0];
    const want = Math.min(n, 5);
    return Array.from({ length: want }, (_, k) => Math.round((k / (want - 1)) * (n - 1)));
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
  // The readout sits beside the rule near the top of the plot, flipping sides at the right edge.
  const tipLeft = hx + 14 + TIP_W > plot.w ? Math.max(0, hx - 14 - TIP_W) : hx + 14;
  const sess = sessRef.current;

  // The glow window: about three point-spacings wide, gradient-edged so the full-strength
  // segment melts into the softened line on both sides.
  const spacingPx = n > 1 && plot.w ? plot.w / (n - 1) : 0;
  const hlW = Math.max(90, Math.min(300, spacingPx * 3));
  const hlLeft = hx - hlW / 2;

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
            </defs>
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

          {/* The gliding glow: a gradient-masked window that slides to the cursor while the copy
              of the line inside counter-slides, so the full-strength segment travels along a line
              that never moves. Both transforms share one clock, cancelling exactly. */}
          {hp && plot.w > 0 && (
            <div
              key={`hl${sess}`}
              className="pointer-events-none absolute inset-y-0 overflow-hidden"
              style={{
                width: hlW,
                left: 0,
                transform: `translateX(${hlLeft}px)`,
                transition: GLIDE,
                WebkitMaskImage: maskCss,
                maskImage: maskCss,
              }}
            >
              <svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                className="absolute inset-y-0 h-full"
                style={{ width: plot.w, left: 0, transform: `translateX(${-hlLeft}px)`, transition: GLIDE }}
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
            </div>
          )}

          {/* Marker and readout in pixels rather than SVG units, so the stretch can't skew them. */}
          {hp && plot.w > 0 && (
            <>
              <div
                key={`rule${sess}`}
                className="pointer-events-none absolute bottom-0 top-0 w-px"
                style={{ left: 0, transform: `translateX(${hx}px)`, transition: GLIDE, background: LINE, opacity: 0.85 }}
              />
              <div
                key={`dot${sess}`}
                className="pointer-events-none absolute left-0 top-0 h-[10px] w-[10px] rounded-full border-2 border-white"
                style={{
                  background: LINE,
                  transform: `translate(calc(${hx}px - 50%), calc(${hy}px - 50%))`,
                  transition: GLIDE,
                }}
              />
              <div
                key={`tip${sess}`}
                className="pointer-events-none absolute left-0 top-1 z-20 rounded-2xl border border-border bg-surface px-3.5 py-2.5 shadow-xl"
                style={{ transform: `translateX(${tipLeft}px)`, transition: GLIDE }}
              >
                <div className="whitespace-nowrap text-[12.5px] font-semibold text-ink">{dayLabel(hp.day, true)}</div>
                <div className="mt-1 flex items-center whitespace-nowrap text-[12px]">
                  <span className="mr-2 h-2 w-2 rounded-full" style={{ background: LINE }} />
                  <span className="text-muted">Total</span>
                  <span className="ml-4 tabular font-semibold text-ink">{money(hp.total)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* X axis, offset to start where the plot starts so ticks sit under the points they name.
          The hovered day gets the dark pill; its label rolls as the date changes. */}
      <div className="relative ml-[52px] mt-2 h-[20px] text-[10.5px] leading-none text-ink-soft">
        {xLabelIdx.map((i) => (
          <span
            key={i}
            className="absolute top-[5px] whitespace-nowrap"
            style={{
              left: `${(px(i) / W) * 100}%`,
              transform: i === 0 ? "none" : i === n - 1 ? "translateX(-100%)" : "translateX(-50%)",
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
              transform: `translateX(calc(${Math.max(28, Math.min(hx, plot.w - 28))}px - 50%))`,
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
