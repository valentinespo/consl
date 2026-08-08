"use client";

import { SkuAvatar } from "@/components/ui";
import { AlertTriangle } from "@/components/icons";
import { useMoney } from "@/components/CurrencyProvider";
import { inflectUnit } from "@/lib/format";
import type { CostChip } from "@/lib/lot-costs";

export type LotLineSummary = {
  sku: string;
  productName: string;
  imageUrl: string | null;
  units: number;
  cogPerUnit: number;
  costs: CostChip[];
};

function Chip({ chip }: { chip: CostChip }) {
  const { perUnit } = useMoney();
  return (
    <span className="whitespace-nowrap text-[10.5px] text-muted">
      {chip.label}{" "}
      <span className={`tabular ${chip.short ? "font-semibold text-negative" : "text-ink-soft"}`}>
        {chip.short ? <AlertTriangle size={11} className="inline-block align-[-1px]" /> : perUnit(chip.value)}
      </span>
    </span>
  );
}

export function LotLineCards({ lines }: { lines: LotLineSummary[] }) {
  const { perUnit, qty } = useMoney();
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {lines.map((ln) => (
        <div key={ln.sku} className="rounded-lg border border-border bg-surface px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <SkuAvatar code={ln.sku} size={30} imageUrl={ln.imageUrl} />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold text-ink">{ln.sku}</div>
              <div className="truncate text-[11px] text-muted">{qty(ln.units)} {inflectUnit("unit", ln.units)}</div>
            </div>
            <div className="text-right">
              <div className="text-[15px] font-semibold tabular text-ink">{perUnit(ln.cogPerUnit)}</div>
              <div className="text-[10px] text-muted">COG / unit</div>
            </div>
          </div>
          {ln.costs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-line pt-1.5">
              {ln.costs.map((c, i) => (
                <Chip key={`${c.label}-${i}`} chip={c} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
