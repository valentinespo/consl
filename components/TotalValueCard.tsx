"use client";

import { useMoney } from "@/components/CurrencyProvider";
import type { RestockTotals } from "@/lib/restock";
import { ValueSparkline } from "@/components/ValueSparkline";
import { BUCKETS } from "@/lib/segments";


/** The headline inventory-value card: total across FBA + AWD + production + raw materials.
 *  Pass `history` (dashboard only) to render the value-over-time sparkline inside the card. */
export function TotalValueCard({
  totals,
  history,
  className = "",
}: {
  totals: RestockTotals;
  history?: { day: string; total: number }[];
  className?: string;
}) {
  const { money } = useMoney();
  return (
    <div className={`flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-accent-strong bg-accent-soft p-5 ${className}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-accent">Total inventory value</div>
      <div className="mt-1 text-[38px] font-medium leading-none tracking-tight text-ink tabular">{money(totals.total)}</div>
      <div className="mt-3.5 flex flex-wrap gap-2">
        {BUCKETS.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[13px]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
            {p.label} <span className="font-medium tabular text-ink">{money(totals[p.key])}</span>
          </span>
        ))}
      </div>
      {history && history.length > 0 && <ValueSparkline data={history} />}
    </div>
  );
}
