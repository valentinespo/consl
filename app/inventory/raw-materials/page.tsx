import { Package } from "@/components/icons";
import { getInventory, getMaterialTypes, type InventoryPool } from "@/lib/queries";
import { money, qty, perUnit, costFine, type Currency } from "@/lib/format";
import { getCurrentOrg } from "@/lib/org";
import { Card, StatCard, PageHeader, SectionTitle, FacilityTag, SkuAvatar } from "@/components/ui";
import { InventoryNav } from "@/components/InventoryNav";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

/** Cheap per-unit items (a few cents) need more decimals than expensive ones. */
function unitCost(value: number, quantity: number, cur: Currency) {
  if (!(quantity > 0)) return "—";
  const c = value / quantity;
  return (c < 0.1 ? costFine : perUnit)(c, cur);
}

function FacilityRow({ pool, unitLabel, cur }: { pool: InventoryPool; unitLabel: string; cur: Currency }) {
  return (
    <div className="flex items-center justify-between border-t border-line py-2 first:border-0">
      <div className="flex items-center gap-2">
        <FacilityTag code={pool.facility} />
        <span className="text-[11.5px] text-muted">
          {unitCost(pool.valueRemaining, pool.quantityRemaining, cur)} / {unitLabel}
        </span>
      </div>
      <div className="flex items-center gap-4 text-right">
        <span className="tabular font-medium text-ink">{qty(pool.quantityRemaining)}</span>
        <span className="tabular w-20 text-[12px] text-ink-soft">{money(pool.valueRemaining, 2, cur)}</span>
      </div>
    </div>
  );
}

type Group = { key: string; sku: string | null; productName: string | null; imageUrl: string | null; pools: InventoryPool[]; totalQty: number; totalValue: number };

export default async function RawMaterialsPage() {
  const [{ pools, totalValue }, materials] = await Promise.all([getInventory(), getMaterialTypes()]);
  const meta = new Map(materials.map((m) => [m.code, m]));
  const live = pools.filter((p) => p.quantityRemaining > 0.5);

  // One section per material that still has stock — no material is special-cased.
  const byMaterial = new Map<string, InventoryPool[]>();
  for (const p of live) {
    const list = byMaterial.get(p.materialCode) ?? [];
    list.push(p);
    byMaterial.set(p.materialCode, list);
  }

  const sections = [...byMaterial.entries()]
    .map(([code, ps]) => {
      // Materials stocked per product (e.g. printed packaging) group by SKU; the rest by facility.
      const perSku = ps.some((p) => p.sku);
      const groups = new Map<string, Group>();
      for (const p of ps) {
        const key = perSku ? (p.sku ?? "?") : "__all__";
        const g =
          groups.get(key) ??
          ({ key, sku: perSku ? (p.sku ?? "?") : null, productName: p.productName, imageUrl: p.imageUrl, pools: [], totalQty: 0, totalValue: 0 } as Group);
        g.pools.push(p);
        g.totalQty += p.quantityRemaining;
        g.totalValue += p.valueRemaining;
        groups.set(key, g);
      }
      const value = ps.reduce((s, p) => s + p.valueRemaining, 0);
      return {
        code,
        name: meta.get(code)?.name ?? ps[0]?.materialName ?? code,
        unitLabel: meta.get(code)?.unitLabel ?? "unit",
        imageUrl: meta.get(code)?.imageUrl ?? null,
        perSku,
        value,
        totalQty: ps.reduce((s, p) => s + p.quantityRemaining, 0),
        groups: [...groups.values()].sort((a, b) => b.totalValue - a.totalValue),
      };
    })
    .sort((a, b) => b.value - a.value);

  const poolCount = live.length;
  const org = await getCurrentOrg().catch(() => null);
  const cur: Currency = { symbol: org?.currencySymbol ?? "$", locale: org?.locale ?? "en-US", code: org?.currencyCode ?? "USD" };

  return (
    <>
      <PageHeader title="Inventory" subtitle="Raw materials on hand, valued oldest-cost-first (FIFO)." />
      <InventoryNav />

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="Total raw value" value={money(totalValue, 2, cur)} sub="FIFO remaining valuation" accent />
        <StatCard label="Materials in stock" value={String(sections.length)} sub={`of ${materials.length} tracked`} />
        <StatCard label="Stock pools" value={String(poolCount)} sub="Material × location" />
        <StatCard
          label="Largest by value"
          value={sections[0] ? sections[0].name : "—"}
          sub={sections[0] ? money(sections[0].value, 2, cur) : "No stock yet"}
        />
      </div>

      {sections.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={Package}
            title="No raw-material stock yet"
            body="Once you log purchases of your raw materials, what's left of each one shows up here — valued oldest-cost-first, broken down by location."
          />
        </div>
      ) : (
        sections.map((s) => (
          <div key={s.code} className="mt-8">
            <SectionTitle>
              {s.name}
              <span className="ml-2 text-[12px] font-normal text-muted">
                {qty(s.totalQty)} {s.unitLabel} · {money(s.value, 2, cur)}
              </span>
            </SectionTitle>
            <div className={`grid grid-cols-1 gap-4 ${s.perSku ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2"}`}>
              {s.groups.map((g) => (
                <Card key={g.key}>
                  <div className="mb-1 flex items-center gap-3">
                    {g.sku ? (
                      <SkuAvatar code={g.sku} size={44} imageUrl={g.imageUrl} />
                    ) : s.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.imageUrl} alt={s.name} className="h-11 w-11 rounded-[12px] border border-border object-cover" />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-border bg-surface-2 text-muted">
                        <Package size={18} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">{g.sku ? (g.productName ?? g.sku) : s.name}</div>
                      <div className="text-[12px] text-muted">
                        {g.pools.length === 1 ? "1 location" : `${g.pools.length} locations`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tabular font-medium text-ink">{qty(g.totalQty)}</div>
                      <div className="tabular text-[12px] text-ink-soft">{money(g.totalValue, 2, cur)}</div>
                    </div>
                  </div>
                  <div className="mt-2">
                    {g.pools.map((p) => (
                      <FacilityRow key={`${g.key}-${p.facility}`} pool={p} unitLabel={s.unitLabel} cur={cur} />
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}
