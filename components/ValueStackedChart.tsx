"use client";

import { useMoney } from "@/components/CurrencyProvider";
import type { ValueHistoryPoint } from "@/lib/restock";

const W = 1000;
const H = 150;

// Bottom → top, matching the value-card pills.
const SERIES = [
  { key: "fba", color: "#16a34a", label: "FBA" },
  { key: "awd", color: "#2563eb", label: "AWD" },
  { key: "inProduction", color: "#f59e0b", label: "In production" },
  { key: "raw", color: "#94a3b8", label: "Raw materials" },
] as const;

/** Stacked area of inventory value split by bucket over time. */
export function ValueStackedChart({ data }: { data: ValueHistoryPoint[] }) {
  const { money } = useMoney();
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
