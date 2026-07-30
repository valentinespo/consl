import Link from "next/link";
import { Package } from "@/components/icons";
import { prisma } from "@/lib/prisma";
import { getInventory, getMaterialTypes, getFinishedStock, type InventoryPool } from "@/lib/queries";
import { money, qty, perUnit, costFine, type Currency } from "@/lib/format";
import { getCurrentOrg } from "@/lib/org";
import { PageHeader, SectionTitle, FacilityTag, SkuAvatar } from "@/components/ui";
import { InventoryMixDonut } from "@/components/InventoryMixDonut";
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

const TH = "px-3 py-2.5 font-medium";
const thRow = "border-b border-line text-left text-[11px] uppercase tracking-wide text-muted";
const tableShell = "overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface";

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

  // ---- In production, aggregated per SKU (one SKU can span several open lots) ----
  type ProdSku = { code: string; name: string; imageUrl: string | null; units: number; value: number; lots: { id: string; nr: number; units: number }[] };
  const prodBySku = new Map<string, ProdSku>();
  for (const lot of prodLots) {
    for (const ln of lot.lines) {
      const g = prodBySku.get(ln.productId) ?? { code: ln.product.code, name: ln.product.name, imageUrl: ln.product.imageUrl, units: 0, value: 0, lots: [] };
      g.units += ln.units;
      g.value += ln.units * ln.cogPerUnit;
      g.lots.push({ id: lot.id, nr: lot.lotNr, units: ln.units });
      prodBySku.set(ln.productId, g);
    }
  }
  const prodSkus = [...prodBySku.values()].sort((a, b) => b.value - a.value);
  const prodUnits = prodSkus.reduce((s, r) => s + r.units, 0);
  const prodValue = prodSkus.reduce((s, r) => s + r.value, 0);

  // ---- Finished stock (per SKU × facility, sorted by value) ----
  const finishedValue = finished.rows.reduce((s, r) => s + r.value, 0);
  const finishedUnits = finished.rows.reduce((s, r) => s + r.units, 0);
  const finFacilities = new Set(finished.rows.map((r) => r.facilityId)).size;

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
    { ...CAT.prod, value: prodValue, sub: `${qty(prodUnits, cur)} units · ${prodLots.length} ${prodLots.length === 1 ? "lot" : "lots"}` },
    { ...CAT.finished, value: finishedValue, sub: `${qty(finishedUnits, cur)} units · ${finFacilities} ${finFacilities === 1 ? "facility" : "facilities"}` },
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
                {rawSections.map((s) => (
                  <RawMaterialRows key={s.code} s={s} cur={cur} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- In production, by SKU ---- */}
      <section className="mt-9">
        <SectionTitle action={<CatTotal color={CAT.prod.color} text={`${money(prodValue, 2, cur)} · ${qty(prodUnits, cur)} units`} />}>In production</SectionTitle>
        {prodSkus.length === 0 ? (
          <EmptyState icon={Package} title="Nothing in production" body="Lots you've started but not yet finished will appear here, broken down by SKU." />
        ) : (
          <div className={tableShell}>
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className={thRow}>
                  <th className={`${TH} pl-4`}>SKU</th>
                  <th className={TH}>Open lots</th>
                  <th className={`${TH} text-right`}>Units</th>
                  <th className={`${TH} pr-4 text-right`}>COG value</th>
                </tr>
              </thead>
              <tbody>
                {prodSkus.map((r, i) => (
                  <tr key={r.code} className={i < prodSkus.length - 1 ? "border-b border-line" : ""}>
                    <td className="py-2.5 pl-4 pr-3">{item(<SkuAvatar code={r.code} imageUrl={r.imageUrl} size={34} />, r.name || r.code, r.code)}</td>
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
                    <td className="px-3 py-2.5 text-right font-medium tabular">{qty(r.units, cur)}</td>
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
        <SectionTitle action={<CatTotal color={CAT.finished.color} text={`${money(finishedValue, 2, cur)} · ${qty(finishedUnits, cur)} units`} />}>Finished stock by facility</SectionTitle>
        {finished.rows.length === 0 ? (
          <EmptyState icon={Package} title="No finished stock on hand" body="Once lots are finished, whatever hasn't shipped to Amazon or sold shows here — the sellable stock sitting at your own facilities." />
        ) : (
          <div className={tableShell}>
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className={thRow}>
                  <th className={`${TH} pl-4`}>SKU</th>
                  <th className={TH}>Facility</th>
                  <th className={`${TH} text-right`}>Unit cost</th>
                  <th className={`${TH} text-right`}>Units</th>
                  <th className={`${TH} pr-4 text-right`}>Value</th>
                </tr>
              </thead>
              <tbody>
                {finished.rows.map((r, i) => (
                  <tr key={`${r.productId}-${r.facilityId}`} className={i < finished.rows.length - 1 ? "border-b border-line" : ""}>
                    <td className="py-2.5 pl-4 pr-3">{item(<SkuAvatar code={r.code} imageUrl={r.imageUrl} size={34} />, r.name || r.code, r.code)}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-2">
                        <FacilityTag code={r.facilityCode} />
                        {r.facilityName && <span className="text-[11.5px] text-muted">{r.facilityName}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular text-ink-soft">{unitCost(r.value, r.units, cur)}</td>
                    <td className="px-3 py-2.5 text-right font-medium tabular">{qty(r.units, cur)}</td>
                    <td className="py-2.5 pl-3 pr-4 text-right font-medium tabular">{money(r.value, 2, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** One material's slice of the raw table: a quiet full-width group header, then a row per
 *  SKU-or-facility pool — image at the left like every other inventory table. */
function RawMaterialRows({
  s,
  cur,
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
}) {
  return (
    <>
      <tr className="border-b border-line bg-surface-2/50">
        <td colSpan={5} className="px-4 py-2 text-[12px]">
          <span className="font-medium text-ink">{s.name}</span>
          <span className="ml-2 tabular text-muted">
            {qty(s.totalQty, cur)} {s.unitLabel} · {money(s.value, 2, cur)}
          </span>
        </td>
      </tr>
      {s.groups.flatMap((g, gi) =>
        g.pools.map((p, pi) => {
          const last = gi === s.groups.length - 1 && pi === g.pools.length - 1;
          const img = g.sku ? (
            <SkuAvatar code={g.sku} size={34} imageUrl={g.imageUrl} />
          ) : s.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.imageUrl} alt={s.name} className="h-[34px] w-[34px] shrink-0 rounded-[10px] border border-border object-cover" />
          ) : (
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface-2 text-muted">
              <Package size={16} />
            </span>
          );
          return (
            <tr key={`${s.code}-${g.key}-${p.facility}`} className={last ? "" : "border-b border-line"}>
              <td className="py-2.5 pl-4 pr-3">
                <div className="flex items-center gap-2.5">
                  {img}
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-ink">{g.sku ? (g.productName ?? g.sku) : s.name}</div>
                    <div className="truncate text-[11px] text-muted">{g.sku ? s.name : s.unitLabel}</div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5">
                <FacilityTag code={p.facility} />
              </td>
              <td className="px-3 py-2.5 text-right tabular text-ink-soft">
                {unitCost(p.valueRemaining, p.quantityRemaining, cur)} / {s.unitLabel}
              </td>
              <td className="px-3 py-2.5 text-right font-medium tabular">{qty(p.quantityRemaining, cur)}</td>
              <td className="py-2.5 pl-3 pr-4 text-right font-medium tabular">{money(p.valueRemaining, 2, cur)}</td>
            </tr>
          );
        }),
      )}
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
