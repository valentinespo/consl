"use client";

import { useMemo, useState } from "react";
import { useMoney } from "@/components/CurrencyProvider";
import type { RestockTotals } from "@/lib/restock";
import { ValueSparkline } from "@/components/ValueSparkline";
import { DateRangePicker, type Range } from "@/components/DateRangePicker";
import { TrendingUp, TrendingDown } from "@/components/icons";
import { RANGES, sliceRange } from "@/lib/chart";
import { BUCKETS } from "@/lib/segments";

/** The headline inventory-value card: total across FBA + AWD + production + raw materials.
 *  Pass `history` (dashboard only) to render the value-over-time chart inside the card.
 *  Layout follows the reference: big number + quiet subtitle on the left, the range picker
 *  stacked over the %-delta on the right, bucket pills, then the chart. */
export function TotalValueCard({
  totals,
  history,
  className = "",
}: {
  totals: RestockTotals;
  history?: { day: string; total: number }[];
  className?: string;
}) {
  const { money, locale } = useMoney();
  const [range, setRange] = useState<Range>({ key: "30", from: "", to: "" });

  const pts = useMemo(
    () => (history?.length ? sliceRange(history, range.key, range.from || undefined, range.to || undefined) : []),
    [history, range],
  );
  const first = pts[0]?.total ?? 0;
  const last = pts[pts.length - 1]?.total ?? 0;
  const delta = last - first;
  const pct = first > 0 ? (delta / first) * 100 : 0;
  const up = delta >= 0;
  const windowLabel =
    range.key === "custom"
      ? "over this range"
      : `over ${(RANGES.find((r) => r.key === range.key)?.label ?? "this range").toLowerCase()}`;

  return (
    <div className={`flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <div className="text-[36px] font-semibold leading-none tracking-tight text-ink tabular">{money(totals.total)}</div>
          <div className="mt-1.5 text-[13px] text-muted">Today&apos;s total inventory value</div>
        </div>
        {history && history.length > 0 && (
          <div className="flex flex-col items-end gap-1.5">
            <DateRangePicker
              value={range}
              onChange={setRange}
              oldest={history[0].day}
              newest={history[history.length - 1].day}
              locale={locale}
            />
            {pts.length >= 2 && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] leading-none"
                style={{
                  background: up ? "rgba(22,163,74,0.10)" : "rgba(220,38,38,0.09)",
                  color: up ? "#16a34a" : "#dc2626",
                }}
              >
                {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                <span className="font-semibold tabular">{Math.abs(pct).toFixed(1)}%</span>
                <span>{windowLabel}</span>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        {BUCKETS.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-2 rounded-[10px] border border-border bg-surface px-3 py-1 text-[13px]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
            {p.label} <span className="font-medium tabular text-ink">{money(totals[p.key])}</span>
          </span>
        ))}
      </div>

      {history && history.length > 0 && <ValueSparkline pts={pts} />}
    </div>
  );
}
