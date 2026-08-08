import React from "react";
import Link from "next/link";
import { Package } from "@/components/icons";
import { prisma } from "@/lib/prisma";
import { getInventory, getMaterialTypes, getFinishedStock, type InventoryPool } from "@/lib/queries";
import { getChannelStock } from "@/lib/integrations";
import { SEG } from "@/lib/segments";
import { money, qty, perUnit, costFine, inflectUnit, type Currency } from "@/lib/format";
import { getCurrentOrg } from "@/lib/org";
import { PageHeader, SectionTitle, FacilityTag, SkuAvatar } from "@/components/ui";
import { InventoryMixDonut } from "@/components/InventoryMixDonut";
import { EmptyState } from "@/components/EmptyState";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

// The three stocks the company physically holds, in pipeline order (inputs → work in progress →
// finished goods). Amazon FBA/AWD stock and its restock maths live on the Reorder page now.
const CAT = {
  raw: { label: "Raw materials", color: SEG.raw }, // the dashboard's raw-materials dot — one colour, one meaning
  prod: { label: "In production", color: "#8b5cf6" },
  finished: { label: "Finished on hand", color: "#16a34a" },
};

/** Cheap per-unit items (a few cents) need more decimals than expensive ones. */
function unitCost(value: number, quantity: number, cur: Currency) {
  if (!(quantity > 0)) return "—";
  const c = value / quantity;
  return (c < 0.1 ? costFine : perUnit)(c, cur);
}

const TH = "px-3 py-2.5 font-medium";
const thRow = "border-b border-line text-left text-[11px] uppercase tracking-wide text-muted";
const tableShell = "overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface";

type RawGroup = { key: string; sku: string | null; productName: string | null; imageUrl: string | null; pools: InventoryPool[]; totalQty: number; totalValue: number };

export default async function InventoryPage() {
  await requireView("inventory");
  const [{ pools, totalValue: rawValue }, materials, prodLots, finished, channelStock, org] = await Promise.all([
    getInventory(),
    getMaterialTypes(),
    prisma.lot
      .findMany({
        // Per-line status: a lot appears while ANY of its SKUs is still cooking, carrying only
        // those in-production lines — finished lot-mates already count as finished stock.
        where: { lines: { some: { status: "IN_PRODUCTION" } } },
        include: { facility: true, lines: { where: { status: "IN_PRODUCTION" }, include: { product: true } } },
        orderBy: [{ poDate: "desc" }, { createdAt: "desc" }],
      }),
    getFinishedStock(),
    getChannelStock(),
    getCurrentOrg().catch(() => null),
  ]);
  const cur: Currency = { symbol: org?.currencySymbol ?? "$", locale: org?.locale ?? "en-US", code: org?.currencyCode ?? "USD" };

  // ---- In production, aggregated per SKU (one SKU can span several open lots) ----
  type ProdSku = { code: string; name: string; imageUrl: string | null; units: number; value: number; facilities: string[]; lots: { id: string; nr: number; units: number }[] };
  const prodBySku = new Map<string, ProdSku>();
  for (const lot of prodLots) {
    for (const ln of lot.lines) {
      const g = prodBySku.get(ln.productId) ?? { code: ln.product.code, name: ln.product.name, imageUrl: ln.product.imageUrl, units: 0, value: 0, facilities: [], lots: [] };
      g.units += ln.units;
      g.value += ln.units * ln.cogPerUnit;
      if (!g.facilities.includes(lot.facility.code)) g.facilities.push(lot.facility.code);
      g.lots.push({ id: lot.id, nr: lot.lotNr, units: ln.units });
      prodBySku.set(ln.productId, g);
    }
  }
  const prodSkus = [...prodBySku.values()].sort((a, b) => b.value - a.value);
  const prodUnits = prodSkus.reduce((s, r) => s + r.units, 0);
  const prodValue = prodSkus.reduce((s, r) => s + r.value, 0);

  // ---- Finished stock (per SKU × facility, sorted by value) ----
  // Connected sales channels hold finished goods too — their reported stock (valued at cost)
  // joins the finished bucket and the table like stock at any other facility.
  const finishedRows = [...finished.rows, ...channelStock.rows].sort((a, b) => b.value - a.value);
  const finishedValue = finishedRows.reduce((s, r) => s + r.value, 0);
  const finishedUnits = finishedRows.reduce((s, r) => s + r.units, 0);
  const finFacilities = new Set(finishedRows.map((r) => r.facilityId)).size;
  // One row per SKU — a SKU held in several places (own warehouse, FBA, AWD…) breaks down into
  // per-facility sub-rows, exactly like the raw-materials table.
  type FinishedSku = { productId: string; code: string; name: string; imageUrl: string | null; units: number; value: number; pools: typeof finishedRows };
  const finBySku = new Map<string, FinishedSku>();
  for (const r of finishedRows) {
    const g = finBySku.get(r.productId) ?? { productId: r.productId, code: r.code, name: r.name, imageUrl: r.imageUrl, units: 0, value: 0, pools: [] };
    g.units += r.units;
    g.value += r.value;
    g.pools.push(r);
    finBySku.set(r.productId, g);
  }
  const finSkus = [...finBySku.values()].sort((a, b) => b.value - a.value);

  // ---- Raw materials, grouped by material then SKU/facility ----
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
    { ...CAT.prod, value: prodValue, sub: `${qty(prodUnits, cur)} ${inflectUnit("unit", prodUnits)} · ${prodLots.length} ${prodLots.length === 1 ? "lot" : "lots"}` },
    { ...CAT.finished, value: finishedValue, sub: `${qty(finishedUnits, cur)} ${inflectUnit("unit", finishedUnits)} · ${finFacilities} ${finFacilities === 1 ? "facility" : "facilities"}` },
  ];
  const denom = totalValue || 1;

  /** The item cell every table opens with: medium avatar + name (+ quiet sub-line). */
  const item = (img: React.ReactNode, name: string, sub?: string | null) => (
    <div className="flex items-center gap-2.5">
      {img}
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-ink">{name}</div>
        {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
      </div>
    </div>
  );

  return (
    <>
      <PageHeader title="Inventory" subtitle="Everything you physically hold — raw materials, work in production, and finished goods on hand." />

      {/* Total inventory hero: the wheel on the left, headline value + proportional bar + the
          three-way split on the right. */}
      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6">
        <div className="flex flex-col items-center gap-6 sm:flex-row">
          <div className="h-[150px] w-[150px] shrink-0">
            <InventoryMixDonut data={tiles.map((t) => ({ label: t.label, value: t.value }))} palette={tiles.map((t) => t.color)} />
          </div>
          <div className="min-w-0 flex-1 self-stretch">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div>
                <div className="text-[13px] font-medium text-muted">Total inventory value</div>
                <div className="mt-1 text-[34px] font-semibold leading-none tracking-tight text-ink tabular">{money(totalValue, 2, cur)}</div>
              </div>
              <div className="text-right text-[13px] text-muted">
                <span className="font-medium text-ink-soft tabular">{qty(productUnits, cur)}</span>
                {" finished & in-production units"}
              </div>
            </div>

            {totalValue > 0 && (
              <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-surface-2">
                {tiles.map((t) => (
                  <div key={t.label} style={{ width: `${(t.value / denom) * 100}%`, background: t.color }} title={`${t.label} · ${money(t.value, 2, cur)}`} />
                ))}
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {tiles.map((t) => (
                <div key={t.label} className="rounded-xl border border-border bg-surface-2/40 p-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} />
                    <span className="text-[12px] font-medium text-ink-soft">{t.label}</span>
                    <span className="ml-auto text-[11px] tabular text-muted">{totalValue > 0 ? Math.round((t.value / denom) * 100) : 0}%</span>
                  </div>
                  <div className="mt-1.5 text-[18px] font-semibold tabular text-ink">{money(t.value, 2, cur)}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted">{t.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Raw materials ---- */}
      <section className="mt-9">
        <SectionTitle action={<CatTotal color={CAT.raw.color} text={money(rawValue, 2, cur)} />}>Raw materials</SectionTitle>
        {rawSections.length === 0 ? (
          <EmptyState icon={Package} title="No raw-material stock yet" body="Log purchases of your raw materials and what's left of each — valued oldest-cost-first, by location — shows up here." />
        ) : (
          <div className={tableShell}>
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className={thRow}>
                  <th className={`${TH} pl-4`}>Item</th>
                  <th className={TH}>Location</th>
                  <th className={`${TH} text-right`}>Unit cost</th>
                  <th className={`${TH} text-right`}>Qty</th>
                  <th className={`${TH} pr-4 text-right`}>Value</th>
                </tr>
              </thead>
              <tbody>
                {rawSections.map((s, si) => (
                  <RawMaterialRows key={s.code} s={s} cur={cur} lastSection={si === rawSections.length - 1} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- In production, by SKU ---- */}
      <section className="mt-9">
        <SectionTitle action={<CatTotal color={CAT.prod.color} text={`${money(prodValue, 2, cur)} · ${qty(prodUnits, cur)} ${inflectUnit("unit", prodUnits)}`} />}>In production</SectionTitle>
        {prodSkus.length === 0 ? (
          <EmptyState icon={Package} title="Nothing in production" body="Lots you've started but not yet finished will appear here, broken down by SKU." />
        ) : (
          <div className={tableShell}>
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className={thRow}>
                  <th className={`${TH} pl-4`}>Item</th>
                  <th className={TH}>Location</th>
                  <th className={TH}>Open lots</th>
                  <th className={`${TH} text-right`}>Unit cost</th>
                  <th className={`${TH} text-right`}>Qty</th>
                  <th className={`${TH} pr-4 text-right`}>Value</th>
                </tr>
              </thead>
              <tbody>
                {prodSkus.map((r, i) => (
                  <tr key={r.code} className={i < prodSkus.length - 1 ? "border-b border-line" : ""}>
                    <td className="py-2.5 pl-4 pr-3">{item(<SkuAvatar code={r.code} imageUrl={r.imageUrl} size={34} />, r.name || r.code, r.code)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {r.facilities.map((fc) => (
                          <FacilityTag key={fc} code={fc} />
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {r.lots.map((l) => (
                          <Link key={`${r.code}-${l.id}`} href={`/lots/${l.id}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-[3px] text-[11px] font-medium text-ink-soft hover:border-ink/25 hover:text-ink">
                            #{l.nr}
                            <span className="font-normal tabular text-muted">· {qty(l.units, cur)}</span>
                          </Link>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular text-ink-soft">{unitCost(r.value, r.units, cur)}</td>
                    <td className="px-3 py-2.5 text-right font-medium tabular">
                      {qty(r.units, cur)} <span className="text-[11.5px] font-normal text-muted">{inflectUnit("unit", r.units)}</span>
                    </td>
                    <td className="py-2.5 pl-3 pr-4 text-right font-medium tabular">{money(r.value, 2, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Finished stock per facility ---- */}
      <section className="mt-9">
        <SectionTitle action={<CatTotal color={CAT.finished.color} text={`${money(finishedValue, 2, cur)} · ${qty(finishedUnits, cur)} ${inflectUnit("unit", finishedUnits)}`} />}>Finished stock by facility</SectionTitle>
        {finishedRows.length === 0 ? (
          <EmptyState icon={Package} title="No finished stock on hand" body="Once lots are finished, whatever hasn't shipped to Amazon or sold shows here — the sellable stock sitting at your own facilities." />
        ) : (
          <div className={tableShell}>
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className={thRow}>
                  <th className={`${TH} pl-4`}>Item</th>
                  <th className={TH}>Location</th>
                  <th className={`${TH} text-right`}>Unit cost</th>
                  <th className={`${TH} text-right`}>Qty</th>
                  <th className={`${TH} pr-4 text-right`}>Value</th>
                </tr>
              </thead>
              <tbody>
                {finSkus.map((g, gi) => {
                  const lastSku = gi === finSkus.length - 1;
                  const multi = g.pools.length > 1;
                  return (
                    <React.Fragment key={g.productId}>
                      <tr className={multi || !lastSku ? "border-b border-line" : ""}>
                        <td className="py-2.5 pl-4 pr-3">{item(<SkuAvatar code={g.code} imageUrl={g.imageUrl} size={34} />, g.name || g.code, g.code)}</td>
                        <td className="px-3 py-2.5">
                          {multi ? (
                            <span className="text-[12px] text-muted">{g.pools.length} locations</span>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              <FacilityTag code={g.pools[0].facilityCode} />
                              {g.pools[0].facilityName && <span className="text-[11.5px] text-muted">{g.pools[0].facilityName}</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular text-ink-soft">{unitCost(g.value, g.units, cur)}</td>
                        <td className="px-3 py-2.5 text-right font-medium tabular">
                          {qty(g.units, cur)} <span className="text-[11.5px] font-normal text-muted">{inflectUnit("unit", g.units)}</span>
                        </td>
                        <td className="py-2.5 pl-3 pr-4 text-right font-medium tabular">{money(g.value, 2, cur)}</td>
                      </tr>
                      {multi &&
                        g.pools.map((p, pi) => (
                          <tr
                            key={`${g.productId}-${p.facilityId}`}
                            className={`bg-surface-2/60 text-[12px] ${pi === g.pools.length - 1 ? (lastSku ? "" : "border-b border-line") : "border-b border-line/60"}`}
                          >
                            <td className="py-1.5 pl-4 pr-3">
                              <span className="block pl-[46px] text-muted">↳</span>
                            </td>
                            <td className="px-3 py-1.5">
                              <span className="inline-flex items-center gap-2">
                                <FacilityTag code={p.facilityCode} />
                                {p.facilityName && <span className="text-[11px] text-muted">{p.facilityName}</span>}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-right tabular text-muted">{unitCost(p.value, p.units, cur)}</td>
                            <td className="px-3 py-1.5 text-right tabular text-ink-soft">
                              {qty(p.units, cur)} <span className="text-[11px] text-muted">{inflectUnit("unit", p.units)}</span>
                            </td>
                            <td className="py-1.5 pl-3 pr-4 text-right tabular text-ink-soft">{money(p.value, 2, cur)}</td>
                          </tr>
                        ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** One material's slice of the raw table: ONE row per material (or per SKU for SKU-stocked
 *  materials like printed pouches) — never per location. Every material opens with the same
 *  tinted group header (name + section totals), so the tint always means "a new material starts
 *  here"; the per-facility ↳ sub-rows underneath a multi-location row stay on the plain surface,
 *  so they read as detail of the row above, never as a new section. */
function RawMaterialRows({
  s,
  cur,
  lastSection,
}: {
  s: {
    code: string;
    name: string;
    unitLabel: string;
    imageUrl: string | null;
    perSku: boolean;
    value: number;
    totalQty: number;
    groups: RawGroup[];
  };
  cur: Currency;
  lastSection: boolean;
}) {
  return (
    <>
      {/* No fill here — the grey wash is reserved for the ↳ detail rows, so it means one thing in
          this table. A section start is carried by its bold name and totals instead. */}
      <tr className="border-b border-line">
        <td colSpan={5} className="px-4 py-2 text-[12px]">
          <span className="font-semibold text-ink">{s.name}</span>
          <span className="ml-2 tabular text-muted">
            {qty(s.totalQty, cur)} {inflectUnit(s.unitLabel, s.totalQty)} · {money(s.value, 2, cur)}
          </span>
        </td>
      </tr>
      {s.groups.map((g, gi) => {
        const lastGroup = gi === s.groups.length - 1;
        const multi = g.pools.length > 1;
        const sorted = [...g.pools].sort((a, b) => b.valueRemaining - a.valueRemaining);
        // The very last line of the whole table skips its bottom border — the card edge closes it.
        const isFinalRow = lastSection && lastGroup;
        // Raw-material rows always show the MATERIAL's picture (e.g. the pouch), never the SKU's —
        // even for SKU-stocked materials, where each row reads "<material> for <SKU code>".
        const img = s.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.imageUrl} alt={s.name} className="h-[34px] w-[34px] shrink-0 rounded-[10px] border border-border object-cover" />
        ) : (
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface-2 text-muted">
            <Package size={16} />
          </span>
        );
        return (
          <React.Fragment key={`${s.code}-${g.key}`}>
            <tr className={multi || !isFinalRow ? "border-b border-line" : ""}>
              <td className="py-2.5 pl-4 pr-3">
                <div className="flex items-center gap-2.5">
                  {img}
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-ink">{g.sku ? `${s.name} for ${g.sku}` : s.name}</div>
                    <div className="truncate text-[11px] text-muted">{g.sku ? (g.productName ?? g.sku) : inflectUnit(s.unitLabel, g.totalQty)}</div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5">
                {multi ? (
                  <span className="text-[12px] text-muted">{g.pools.length} locations</span>
                ) : (
                  <FacilityTag code={sorted[0].facility} />
                )}
              </td>
              <td className="px-3 py-2.5 text-right tabular text-ink-soft">
                {unitCost(g.totalValue, g.totalQty, cur)} / {s.unitLabel}
              </td>
              <td className="px-3 py-2.5 text-right font-medium tabular">
                {qty(g.totalQty, cur)} <span className="text-[11.5px] font-normal text-muted">{inflectUnit(s.unitLabel, g.totalQty)}</span>
              </td>
              <td className="py-2.5 pl-3 pr-4 text-right font-medium tabular">{money(g.totalValue, 2, cur)}</td>
            </tr>
            {/* A multi-location material breaks down into one quiet sub-row per facility, every
                column carrying that facility's own numbers. */}
            {multi &&
              sorted.map((p, pi) => (
                <tr
                  key={`${s.code}-${g.key}-${p.facility}`}
                  className={`bg-surface-2/60 text-[12px] ${pi === sorted.length - 1 ? (isFinalRow ? "" : "border-b border-line") : "border-b border-line/60"}`}
                >
                  <td className="py-1.5 pl-4 pr-3">
                    <span className="block pl-[46px] text-muted">↳</span>
                  </td>
                  <td className="px-3 py-1.5">
                    <FacilityTag code={p.facility} />
                  </td>
                  <td className="px-3 py-1.5 text-right tabular text-muted">
                    {unitCost(p.valueRemaining, p.quantityRemaining, cur)} / {s.unitLabel}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular text-ink-soft">
                    {qty(p.quantityRemaining, cur)} <span className="text-[11px] text-muted">{inflectUnit(s.unitLabel, p.quantityRemaining)}</span>
                  </td>
                  <td className="py-1.5 pl-3 pr-4 text-right tabular text-ink-soft">{money(p.valueRemaining, 2, cur)}</td>
                </tr>
              ))}
          </React.Fragment>
        );
      })}
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
