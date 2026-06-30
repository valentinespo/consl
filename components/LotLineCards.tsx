import { SkuAvatar } from "@/components/ui";
import { perUnit, qty } from "@/lib/format";

export type LotLineSummary = {
  sku: string;
  productName: string;
  imageUrl: string | null;
  units: number;
  cogPerUnit: number;
  teaCostPerUnit: number;
  teabagCostPerUnit: number;
  pouchCostPerUnit: number;
  otherCostPerUnit: number;
  short: string[];
};

function CostChip({ label, value, short }: { label: string; value: number; short?: boolean }) {
  return (
    <span className="whitespace-nowrap text-[10.5px] text-muted">
      {label}{" "}
      <span className={`tabular ${short ? "font-semibold text-negative" : "text-ink-soft"}`}>{short ? "⚠" : perUnit(value)}</span>
    </span>
  );
}

export function LotLineCards({ lines }: { lines: LotLineSummary[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {lines.map((ln) => (
        <div key={ln.sku} className="rounded-lg border border-border bg-surface px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <SkuAvatar code={ln.sku} size={30} imageUrl={ln.imageUrl} />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold text-ink">{ln.sku}</div>
              <div className="truncate text-[11px] text-muted">{qty(ln.units)} units</div>
            </div>
            <div className="text-right">
              <div className="text-[15px] font-semibold tabular text-ink">{perUnit(ln.cogPerUnit)}</div>
              <div className="text-[10px] text-muted">COG / unit</div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-line pt-1.5">
            <CostChip label="Tea" value={ln.teaCostPerUnit} />
            {ln.teabagCostPerUnit > 0 && <CostChip label="Bag" value={ln.teabagCostPerUnit} short={ln.short.includes("TEABAG")} />}
            <CostChip label="Pouch" value={ln.pouchCostPerUnit} short={ln.short.includes("POUCH")} />
            {ln.otherCostPerUnit > 0 && <CostChip label="Other" value={ln.otherCostPerUnit} />}
          </div>
        </div>
      ))}
    </div>
  );
}
