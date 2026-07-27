"use client";

import { useMoney } from "@/components/CurrencyProvider";
import type { ValueHistoryPoint } from "@/lib/restock";
import { BUCKETS as SERIES } from "@/lib/segments";

const W = 1000;
const H = 150;


/** Stacked area of inventory value split by bucket over time. */
export function ValueStackedChart({ data }: { data: ValueHistoryPoint[] }) {
  const { money } = useMoney();
  // A brand-new org has no history yet (the first snapshot is written at the end of the day's
  // first sync), so the widget must survive an empty array — the value-per-bucket legend below
  // reads the last point and would otherwise crash the whole dashboard on a company's first load.
  if (data.length === 0) {
    return (
      <div className="flex h-full min-h-[64px] items-center justify-center text-[12px] text-muted">
        No history yet — this fills in daily.
      </div>
    );
  }
  // Need ≥2 points to form a band; duplicate a lone point so it renders as a flat stack.
  const pts = data.length === 1 ? [data[0], data[0]] : data;
  const n = pts.length;
  const maxTotal = Math.max(1, ...pts.map((p) => p.total));
  const x = (i: number) => (n === 1 ? W : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / maxTotal) * H;

  // Cumulative baselines per point (bottom to top).
  const cum = pts.map(() => 0);
  const bands = SERIES.map((s) => {
    const bottom = pts.map((_, i) => cum[i]);
    pts.forEach((p, i) => (cum[i] += (p as unknown as Record<string, number>)[s.key] ?? 0));
    const top = pts.map((_, i) => cum[i]);
    const topPath = top.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
    const botPath = bottom
      .map((v, i) => `L ${x(n - 1 - i)} ${y(bottom[n - 1 - i])}`)
      .join(" ");
    return { ...s, d: `${topPath} ${botPath} Z` };
  });

  const last = pts[pts.length - 1];

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-[64px] flex-1">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
          {bands.map((b) => (
            <path key={b.key} d={b.d} fill={b.color} fillOpacity={0.82} />
          ))}
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
            <span className="text-muted">{s.label}</span>
            <span className="tabular font-medium text-ink-soft">{money((last as unknown as Record<string, number>)[s.key] ?? 0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
