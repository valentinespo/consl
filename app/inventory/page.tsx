import Link from "next/link";
import { Package } from "@/components/icons";
import { prisma } from "@/lib/prisma";
import { getInventory, getMaterialTypes, getFinishedStock, type InventoryPool } from "@/lib/queries";
import { money, qty, perUnit, costFine, date, type Currency } from "@/lib/format";
import { getCurrentOrg } from "@/lib/org";
import { Card, PageHeader, SectionTitle, FacilityTag, SkuAvatar } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

// The three stocks the company physically holds, in pipeline order (inputs → work in progress →
// finished goods). Amazon FBA/AWD stock and its restock maths live on the Reorder page now.
const CAT = {
  raw: { label: "Raw materials", color: "#f59e0b" },
  prod: { label: "In production", color: "#8b5cf6" },
  finished: { label: "Finished on hand", color: "#16a34a" },
};

/** Cheap per-unit items (a few cents) need more decimals than expensive ones. */
function unitCost(value: number, quantity: number, cur: Currency) {
  if (!(quantity > 0)) return "—";
  const c = value / quantity;
  return (c < 0.1 ? costFine : perUnit)(c, cur);
}

type RawGroup = { key: string; sku: string | null; productName: string | null; imageUrl: string | null; pools: InventoryPool[]; totalQty: number; totalValue: number };

export default async function InventoryPage() {
  await requireView("inventory");
  const [{ pools, totalValue: rawValue }, materials, prodLots, finished, org] = await Promise.all([
    getInventory(),
    getMaterialTypes(),
    prisma.lot.findMany({
      where: { status: "IN_PRODUCTION" },
      include: { facility: true, lines: { include: { product: true } } },
      orderBy: [{ poDate: "desc" }, { createdAt: "desc" }],
    }),
    getFinishedStock(),
    getCurrentOrg().catch(() => null),
  ]);
  const cur: Currency = { symbol: org?.currencySymbol ?? "$", locale: org?.locale ?? "en-US", code: org?.currencyCode ?? "USD" };

  // ---- In production ----
  const prodRows = prodLots.map((l) => ({
    id: l.id,
    nr: l.lotNr,
    poDate: l.poDate,
    facility: l.facility.code,
    lines: l.lines,
    units: l.lines.reduce((s, x) => s + x.units, 0),
    value: l.lines.reduce((s, x) => s + x.units * x.cogPerUnit, 0),
  }));
  const prodUnits = prodRows.reduce((s, r) => s + r.units, 0);
  const prodValue = prodRows.reduce((s, r) => s + r.value, 0);

  // ---- Finished stock, grouped per facility ----
  const finByFacility = new Map<string, { code: string; name: string; rows: typeof finished.rows; value: number; units: number }>();
  for (const r of finished.rows) {
    const g = finByFacility.get(r.facilityId) ?? { code: r.facilityCode, name: r.facilityName, rows: [], value: 0, units: 0 };
    g.rows.push(r);
    g.value += r.value;
    g.units += r.units;
    finByFacility.set(r.facilityId, g);
  }
  const finFacilities = [...finByFacility.values()].sort((a, b) => b.value - a.value);
  const finishedValue = finished.rows.reduce((s, r) => s + r.value, 0);
  const finishedUnits = finished.rows.reduce((s, r) => s + r.units, 0);

  // ---- Raw materials, grouped by material then SKU/facility (mirrors the old Raw tab) ----
  const meta = new Map(materials.map((m) => [m.code, m]));
  const live = pools.filter((p) => p.quantityRemaining > 0.5);
  const byMaterial = new Map<string, InventoryPool[]>();
  for (const p of live) {
    const list = byMaterial.get(p.materialCode) ?? [];
    list.push(p);
    byMaterial.set(p.materialCode, list);
  }
  const rawSections = [...byMaterial.entries()]
    .map(([code, ps]) => {
      const perSku = ps.some((p) => p.sku);
      const groups = new Map<string, RawGroup>();
      for (const p of ps) {
        const key = perSku ? (p.sku ?? "?") : "__all__";
        const g =
          groups.get(key) ??
          ({ key, sku: perSku ? (p.sku ?? "?") : null, productName: p.productName, imageUrl: p.imageUrl, pools: [], totalQty: 0, totalValue: 0 } as RawGroup);
        g.pools.push(p);
        g.totalQty += p.quantityRemaining;
        g.totalValue += p.valueRemaining;
        groups.set(key, g);
      }
      return {
        code,
        name: meta.get(code)?.name ?? ps[0]?.materialName ?? code,
        unitLabel: meta.get(code)?.unitLabel ?? "unit",
        imageUrl: meta.get(code)?.imageUrl ?? null,
        perSku,
        value: ps.reduce((s, p) => s + p.valueRemaining, 0),
        totalQty: ps.reduce((s, p) => s + p.quantityRemaining, 0),
        groups: [...groups.values()].sort((a, b) => b.totalValue - a.totalValue),
      };
    })
    .sort((a, b) => b.value - a.value);

  // ---- Totals for the hero ----
  const totalValue = rawValue + prodValue + finishedValue;
  const productUnits = prodUnits + finishedUnits; // raw is in mixed units, so counted separately
  const tiles = [
    { ...CAT.raw, value: rawValue, sub: `${rawSections.length} ${rawSections.length === 1 ? "material" : "materials"}` },
    { ...CAT.prod, value: prodValue, sub: `${qty(prodUnits, cur)} units · ${prodRows.length} ${prodRows.length === 1 ? "lot" : "lots"}` },
    { ...CAT.finished, value: finishedValue, sub: `${qty(finishedUnits, cur)} units · ${finFacilities.length} ${finFacilities.length === 1 ? "facility" : "facilities"}` },
  ];
  const denom = totalValue || 1;

  return (
    <>
      <PageHeader title="Inventory" subtitle="Everything you physically hold — raw materials, work in production, and finished goods on hand." />

      {/* Total inventory hero: the headline value, a proportional bar, and the three-way split. */}
      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <div className="text-[13px] font-medium text-muted">Total inventory value</div>
            <div className="mt-1 text-[38px] font-semibold leading-none tracking-tight text-ink tabular">{money(totalValue, 2, cur)}</div>
          </div>
          <div className="text-right text-[13px] text-muted">
            <span className="font-medium text-ink-soft tabular">{qty(productUnits, cur)}</span>{" "}finished &amp; in-production units
          </div>
        </div>

        {totalValue > 0 && (
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-surface-2">
            {tiles.map((t) => (
              <div key={t.label} style={{ width: `${(t.value / denom) * 100}%`, background: t.color }} title={`${t.label} · ${money(t.value, 2, cur)}`} />
            ))}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-border bg-surface-2/40 p-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                <span className="text-[12.5px] font-medium text-ink-soft">{t.label}</span>
                <span className="ml-auto text-[11px] tabular text-muted">{totalValue > 0 ? Math.round((t.value / denom) * 100) : 0}%</span>
              </div>
              <div className="mt-2 text-[22px] font-semibold tabular text-ink">{money(t.value, 2, cur)}</div>
              <div className="mt-0.5 text-[12px] text-muted">{t.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Raw materials ---- */}
      <section className="mt-9">
        <SectionTitle action={<CatTotal color={CAT.raw.color} text={money(rawValue, 2, cur)} />}>Raw materials</SectionTitle>
        {rawSections.length === 0 ? (
          <EmptyState icon={Package} title="No raw-material stock yet" body="Log purchases of your raw materials and what's left of each — valued oldest-cost-first, by location — shows up here." />
        ) : (
          <div className="space-y-6">
            {rawSections.map((s) => (
              <div key={s.code}>
                <div className="mb-2 flex items-center gap-2 text-[13px]">
                  <span className="font-medium text-ink">{s.name}</span>
                  <span className="text-muted">
                    {qty(s.totalQty, cur)} {s.unitLabel} · {money(s.value, 2, cur)}
                  </span>
                </div>
                <div className={`grid grid-cols-1 gap-3 ${s.perSku ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2"}`}>
                  {s.groups.map((g) => (
                    <Card key={g.key}>
                      <div className="mb-1 flex items-center gap-3">
                        {g.sku ? (
                          <SkuAvatar code={g.sku} size={40} imageUrl={g.imageUrl} />
                        ) : s.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.imageUrl} alt={s.name} className="h-10 w-10 rounded-[12px] border border-border object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-border bg-surface-2 text-muted">
                            <Package size={18} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-ink">{g.sku ? (g.productName ?? g.sku) : s.name}</div>
                          <div className="text-[12px] text-muted">{g.pools.length === 1 ? "1 location" : `${g.pools.length} locations`}</div>
                        </div>
                        <div className="text-right">
                          <div className="tabular font-medium text-ink">{qty(g.totalQty, cur)}</div>
                          <div className="tabular text-[12px] text-ink-soft">{money(g.totalValue, 2, cur)}</div>
                        </div>
                      </div>
                      <div className="mt-2">
                        {g.pools.map((p) => (
                          <div key={`${g.key}-${p.facility}`} className="flex items-center justify-between border-t border-line py-2 first:border-0">
                            <div className="flex items-center gap-2">
                              <FacilityTag code={p.facility} />
                              <span className="text-[11.5px] text-muted">
                                {unitCost(p.valueRemaining, p.quantityRemaining, cur)} / {s.unitLabel}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 text-right">
                              <span className="tabular font-medium text-ink">{qty(p.quantityRemaining, cur)}</span>
                              <span className="tabular w-20 text-[12px] text-ink-soft">{money(p.valueRemaining, 2, cur)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- In production ---- */}
      <section className="mt-9">
        <SectionTitle action={<CatTotal color={CAT.prod.color} text={`${money(prodValue, 2, cur)} · ${qty(prodUnits, cur)} units`} />}>In production</SectionTitle>
        {prodRows.length === 0 ? (
          <EmptyState icon={Package} title="Nothing in production" body="Lots you've started but not yet finished will appear here, with their SKUs and carried COG value." />
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-medium">Lot</th>
                  <th className="px-3 py-2.5 font-medium">Facility</th>
                  <th className="px-3 py-2.5 font-medium">SKUs</th>
                  <th className="px-3 py-2.5 text-right font-medium">Units</th>
                  <th className="px-4 py-2.5 text-right font-medium">COG value</th>
                </tr>
              </thead>
              <tbody>
                {prodRows.map((r, i) => (
                  <tr key={r.id} className={i < prodRows.length - 1 ? "border-b border-line" : ""}>
                    <td className="px-4 py-3">
                      <Link href={`/lots/${r.id}`} className="font-medium text-ink hover:underline">
                        #{r.nr}
                      </Link>
                      <div className="text-[11px] text-muted">{r.poDate ? date(r.poDate.toISOString().slice(0, 10), cur) : "—"}</div>
                    </td>
                    <td className="px-3 py-3">
                      <FacilityTag code={r.facility} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2.5">
                        {r.lines.map((ln) => (
                          <span key={ln.id} className="inline-flex items-center gap-1.5">
                            <SkuAvatar code={ln.product.code} imageUrl={ln.product.imageUrl} size={22} />
                            <span className="text-[11px] tabular text-muted">{qty(ln.units, cur)}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-medium tabular">{qty(r.units, cur)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular">{money(r.value, 2, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Finished stock per facility ---- */}
      <section className="mt-9">
        <SectionTitle action={<CatTotal color={CAT.finished.color} text={`${money(finishedValue, 2, cur)} · ${qty(finishedUnits, cur)} units`} />}>Finished stock by facility</SectionTitle>
        {finFacilities.length === 0 ? (
          <EmptyState icon={Package} title="No finished stock on hand" body="Once lots are finished, whatever hasn't shipped to Amazon or sold shows here — the sellable stock sitting at your own facilities." />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {finFacilities.map((f) => (
              <Card key={f.code}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <FacilityTag code={f.code} />
                    {f.name && <span className="truncate text-[12.5px] text-muted">{f.name}</span>}
                  </div>
                  <div className="text-right">
                    <div className="tabular font-medium text-ink">{money(f.value, 2, cur)}</div>
                    <div className="tabular text-[11.5px] text-muted">{qty(f.units, cur)} units</div>
                  </div>
                </div>
                <div>
                  {f.rows.map((r) => (
                    <div key={`${f.code}-${r.productId}`} className="flex items-center gap-3 border-t border-line py-2 first:border-0">
                      <SkuAvatar code={r.code} imageUrl={r.imageUrl} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-ink">{r.name || r.code}</div>
                        <div className="text-[11.5px] text-muted">{unitCost(r.value, r.units, cur)} / unit</div>
                      </div>
                      <div className="text-right">
                        <div className="tabular text-[13px] font-medium text-ink">{qty(r.units, cur)}</div>
                        <div className="tabular text-[11.5px] text-ink-soft">{money(r.value, 2, cur)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/** A small coloured-dot subtotal for a section header. */
function CatTotal({ color, text }: { color: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12.5px] text-muted">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="tabular">{text}</span>
    </span>
  );
}
