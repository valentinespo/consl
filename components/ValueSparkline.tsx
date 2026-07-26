"use client";

import { useMemo, useState } from "react";
import { useMoney } from "@/components/CurrencyProvider";
import { RANGES, compactMoney, niceTicks, sliceRange, type RangeKey } from "@/lib/chart";

const W = 1000;
const H = 150;
const TIP_W = 236; // wide enough to keep the label and the amount on one line
const LINE = "#2563eb";

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

/** Inventory value over time: labelled axes, a hover readout per day, and a selectable window. */
export function ValueSparkline({ data }: { data: { day: string; total: number }[] }) {
  const { money, locale, symbol } = useMoney();
  const [range, setRange] = useState<RangeKey>("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  // Measured on hover so the marker and tooltip can be placed in real pixels: the SVG is stretched
  // with preserveAspectRatio="none", so its own coordinates don't map onto the box one-to-one.
  const [plot, setPlot] = useState({ w: 0, h: 0 });

  const pts = useMemo(
    () => sliceRange(data, range, from || undefined, to || undefined),
    [data, range, from, to],
  );

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

  const first = pts[0]?.total ?? 0;
  const last = pts[n - 1]?.total ?? 0;
  const delta = last - first;
  const pct = first > 0 ? (delta / first) * 100 : 0;
  const up = delta >= 0;

  // Enough labels to read the axis, few enough not to collide on a narrow widget.
  const xLabelIdx = useMemo(() => {
    if (n <= 1) return [0];
    const want = Math.min(n, 5);
    return Array.from({ length: want }, (_, k) => Math.round((k / (want - 1)) * (n - 1)));
  }, [n]);

  const dayLabel = (iso: string, long = false) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      ...(long ? { weekday: "long" } : {}),
    });

  function track(e: React.MouseEvent<HTMLDivElement>) {
    if (n === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPlot({ w: r.width, h: r.height });
    const f = (e.clientX - r.left) / (r.width || 1);
    setHover(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))));
  }

  const hp = hover != null ? pts[hover] : null;
  const hx = hover != null && plot.w ? (px(hover) / W) * plot.w : 0;
  const hy = hp && plot.h ? (py(hp.total) / H) * plot.h : 0;
  const tipBelow = hy < 78; // not enough headroom above the point — drop it underneath

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-2">
          <span className="font-medium uppercase tracking-wide text-accent/70">Value over time</span>
          {n >= 2 && (
            <span className="tabular font-medium" style={{ color: up ? "#16a34a" : "#dc2626" }}>
              {up ? "▲" : "▼"} {money(Math.abs(delta))} ({pct >= 0 ? "+" : ""}
              {pct.toFixed(1)}%)
            </span>
          )}
        </span>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as RangeKey)}
          aria-label="Date range"
          className="rounded-lg border border-border bg-surface px-2 py-1 text-[11px] text-ink-soft outline-none hover:border-accent-strong focus:border-accent-strong"
        >
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {range === "custom" && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date"
            className="rounded-lg border border-border bg-surface px-2 py-1 text-ink outline-none focus:border-accent-strong"
          />
          <span>to</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date"
            className="rounded-lg border border-border bg-surface px-2 py-1 text-ink outline-none focus:border-accent-strong"
          />
        </div>
      )}

      {n === 0 ? (
        <div className="flex min-h-[40px] flex-1 items-center justify-center text-[11px] text-muted">
          No days recorded in this range.
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1">
            {/* Y axis as its own column, so a long label can never sit on top of the plot. */}
            <div className="flex w-[52px] shrink-0 flex-col justify-between pr-2 text-right text-[10px] leading-none text-muted tabular">
              {[...axis.ticks].reverse().map((t) => (
                <span key={t}>{compactMoney(t, symbol, locale)}</span>
              ))}
            </div>

            <div
              className="relative min-h-[40px] w-full flex-1"
              onMouseMove={track}
              onMouseLeave={() => setHover(null)}
            >
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
                <defs>
                  <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={LINE} stopOpacity="0.28" />
                    <stop offset="70%" stopColor={LINE} stopOpacity="0.05" />
                    <stop offset="100%" stopColor={LINE} stopOpacity="0" />
                  </linearGradient>
                </defs>
                {axis.ticks.map((t) => (
                  <line
                    key={t}
                    x1={0}
                    x2={W}
                    y1={py(t)}
                    y2={py(t)}
                    stroke="currentColor"
                    className="text-border"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                <path d={area} fill="url(#spark-fill)" />
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

              {/* Marker and readout in pixels rather than SVG units, so the stretch can't skew them.
                  Drawn only while hovering — a dot on every day would bury the shape of the line. */}
              {hp && plot.w > 0 && (
                <>
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
                    style={{ left: hx }}
                  />
                  <div
                    className="pointer-events-none absolute h-[9px] w-[9px] rounded-full border-2 border-white"
                    style={{ left: hx, top: hy, background: LINE, transform: "translate(-50%, -50%)" }}
                  />
                  <div
                    className="pointer-events-none absolute z-20 flex gap-2 rounded-xl border border-border bg-surface p-2.5 shadow-xl"
                    style={{
                      width: TIP_W,
                      left: Math.max(TIP_W / 2, Math.min(hx, plot.w - TIP_W / 2)),
                      top: tipBelow ? hy + 14 : hy - 14,
                      transform: `translate(-50%, ${tipBelow ? "0" : "-100%"})`,
                    }}
                  >
                    <span className="w-[3px] shrink-0 rounded-full" style={{ background: LINE }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold text-ink">
                        {dayLabel(hp.day, true)}
                      </span>
                      <span className="mt-0.5 flex items-baseline justify-between gap-3 whitespace-nowrap text-[11.5px]">
                        <span className="text-muted">Inventory value</span>
                        <span className="tabular font-medium text-ink">{money(hp.total)}</span>
                      </span>
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* X axis, offset to start where the plot starts so ticks sit under the points they name. */}
          <div className="relative mt-1.5 ml-[52px] h-[12px] text-[10px] leading-none text-muted">
            {xLabelIdx.map((i) => (
              <span
                key={i}
                className="absolute whitespace-nowrap"
                style={{
                  left: `${(px(i) / W) * 100}%`,
                  transform:
                    i === 0 ? "none" : i === n - 1 ? "translateX(-100%)" : "translateX(-50%)",
                }}
              >
                {dayLabel(pts[i].day)}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
