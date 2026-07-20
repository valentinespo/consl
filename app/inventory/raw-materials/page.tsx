import { getInventory, type InventoryPool } from "@/lib/queries";
import { money, qty, perUnit, costFine } from "@/lib/format";
import { Card, StatCard, PageHeader, SectionTitle, FacilityTag, SkuAvatar } from "@/components/ui";
import { InventoryNav } from "@/components/InventoryNav";

export const dynamic = "force-dynamic";

function FacilityRow({ pool, unitLabel }: { pool: InventoryPool; unitLabel: string }) {
  return (
    <div className="flex items-center justify-between border-t border-line py-2 first:border-0">
      <div className="flex items-center gap-2">
        <FacilityTag code={pool.facility} />
        <span className="text-[11.5px] text-muted">
          {(unitLabel === "bag" ? costFine : perUnit)(pool.valueRemaining / pool.quantityRemaining)} / {unitLabel}
        </span>
      </div>
      <div className="flex items-center gap-4 text-right">
        <span className="font-medium text-ink tabular">{qty(pool.quantityRemaining)}</span>
        <span className="w-20 text-[12px] tabular text-ink-soft">{money(pool.valueRemaining)}</span>
      </div>
    </div>
  );
}

export default async function RawMaterialsPage() {
  const { pools, totalValue, teabagUnits, pouchUnits } = await getInventory();
  const teabags = pools.filter((p) => p.materialCode === "TEABAG" && p.quantityRemaining > 0.5);

  const pouchBySku = new Map<
    string,
    { sku: string; productName: string | null; imageUrl: string | null; facilities: InventoryPool[]; totalQty: number; totalValue: number }
  >();
  for (const p of pools) {
    if (p.materialCode !== "POUCH" || p.quantityRemaining <= 0.5) continue;
    const key = p.sku ?? "?";
    const g = pouchBySku.get(key) ?? { sku: key, productName: p.productName, imageUrl: p.imageUrl, facilities: [], totalQty: 0, totalValue: 0 };
    g.facilities.push(p);
    g.totalQty += p.quantityRemaining;
    g.totalValue += p.valueRemaining;
    pouchBySku.set(key, g);
  }
  const pouchGroups = [...pouchBySku.values()].sort((a, b) => b.totalValue - a.totalValue);
  const teabagValue = teabags.reduce((s, p) => s + p.valueRemaining, 0);

  return (
    <>
      <PageHeader title="Inventory" subtitle="Raw materials on hand, valued oldest-cost-first (FIFO)." />
      <InventoryNav />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="Total raw value" value={money(totalValue)} sub="FIFO remaining valuation" accent />
        <StatCard label="Tea bags on hand" value={qty(teabagUnits)} sub={`Across ${teabags.length} facilities`} />
        <StatCard label="Pouches on hand" value={qty(pouchUnits)} sub={`${pouchGroups.length} products`} />
        <StatCard label="Stock pools" value={String(teabags.length + pouchGroups.reduce((s, g) => s + g.facilities.length, 0))} sub="Material × location" />
      </div>

      <div className="mt-6">
        <SectionTitle>Tea bags</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {teabags.length > 0 ? (
            <Card>
              <div className="mb-1 flex items-center gap-3">
                {teabags[0]?.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={teabags[0].imageUrl} alt="Tea bags" className="h-11 w-11 rounded-[12px] border border-border object-cover" />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-border bg-surface-2 text-[11px] font-medium text-muted">TB</div>
                )}
                <div className="flex-1">
                  <div className="font-medium text-ink">Tea bags</div>
                  <div className="text-[12px] text-muted">One material, stocked across facilities</div>
                </div>
                <div className="text-right">
                  <div className="font-medium text-ink tabular">{qty(teabagUnits)}</div>
                  <div className="text-[12px] tabular text-ink-soft">{money(teabagValue)}</div>
                </div>
              </div>
              <div className="mt-2">
                {teabags.map((p) => (
                  <FacilityRow key={p.facility} pool={p} unitLabel="bag" />
                ))}
              </div>
            </Card>
          ) : (
            <Empty>No tea-bag stock remaining.</Empty>
          )}
        </div>
      </div>

      <div className="mt-8">
        <SectionTitle>Pouches — by product</SectionTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pouchGroups.map((g) => (
            <Card key={g.sku}>
              <div className="mb-1 flex items-center gap-3">
                <SkuAvatar code={g.sku} size={44} imageUrl={g.imageUrl} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{g.productName}</div>
                  <div className="text-[12px] text-muted">{g.facilities.length === 1 ? "1 facility" : `${g.facilities.length} facilities`}</div>
                </div>
                <div className="text-right">
                  <div className="font-medium text-ink tabular">{qty(g.totalQty)}</div>
                  <div className="text-[12px] tabular text-ink-soft">{money(g.totalValue)}</div>
                </div>
              </div>
              <div className="mt-2">
                {g.facilities.map((p) => (
                  <FacilityRow key={`${g.sku}-${p.facility}`} pool={p} unitLabel="pouch" />
                ))}
              </div>
            </Card>
          ))}
          {pouchGroups.length === 0 && <Empty>No pouch stock remaining.</Empty>}
        </div>
      </div>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full rounded-[var(--radius-card)] border border-dashed border-border bg-surface-2 px-5 py-8 text-center text-[13px] text-muted">
      {children}
    </div>
  );
}
