"use client";

import { useMoney } from "@/components/CurrencyProvider";

const W = 1000;
const H = 150;

/** Smooth (cardinal-spline) line + area path for a series of values, drawn in a 0..W / 0..H box. */
function paths(vals: number[]) {
  const n = vals.length;
  if (n === 0) return { line: "", area: "" };
  if (n === 1) {
    const y = H * 0.5;
    return { line: `M0 ${y} L ${W} ${y}`, area: `M0 ${y} L ${W} ${y} L ${W} ${H} L 0 ${H} Z` };
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const padY = H * 0.16;
  const pts: [number, number][] = vals.map((v, i) => [(i / (n - 1)) * W, padY + (1 - (v - min) / span) * (H - 2 * padY)]);
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
  return { line, area: `${line} L ${W} ${H} L 0 ${H} Z` };
}

/** Sleek fintech-style area sparkline of inventory value over time, fading to the bottom. */
export function ValueSparkline({ data }: { data: { day: string; total: number }[] }) {
  const { money } = useMoney();
  const vals = data.map((d) => d.total);
  const { line, area } = paths(vals);
  const first = vals[0] ?? 0;
  const last = vals[vals.length - 1] ?? 0;
  const delta = last - first;
  const pct = first > 0 ? (delta / first) * 100 : 0;
  const up = delta >= 0;
  const many = vals.length >= 2;
  const gid = "spark-fill";

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="font-medium uppercase tracking-wide text-accent/70">Value over time</span>
        {many ? (
          <span className="tabular font-medium" style={{ color: up ? "#16a34a" : "#dc2626" }}>
            {up ? "▲" : "▼"} {money(Math.abs(delta))} ({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%) · {vals.length}d
          </span>
        ) : (
          <span className="text-muted">tracking started — grows daily</span>
        )}
      </div>
      <div className="relative min-h-[40px] w-full flex-1">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.28" />
              <stop offset="70%" stopColor="#2563eb" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gid})`} />
          <path d={line} fill="none" stroke="#2563eb" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </div>
  );
}
