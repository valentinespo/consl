import Link from "next/link";
import { ChevronRight, Warehouse, Truck, Package, Plug, Lock, AlertTriangle } from "@/components/icons";
import {
  getFacilitiesDetailed,
  getFinishedStock,
  getRawStockByFacility,
  getMovements,
  getProducts,
  getMaterialTypes,
  getFacilities,
} from "@/lib/queries";
import { prisma } from "@/lib/prisma";
import { getFmt } from "@/lib/fmt-server";
import { inflectUnit } from "@/lib/format";
import { PageHeader, Card, SectionTitle, SkuAvatar } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { NewFacilityButton } from "@/components/NewFacilityButton";
import { NewMovementPanel, type OnHandRow } from "@/components/MovementForm";
import { MovementsLedger } from "@/components/MovementsLedger";
import { StockSection } from "@/components/StockSection";
import { facilityTypeLabel, isProductionSite } from "@/lib/facility-types";
import { appearedAt } from "@/lib/lot-status";
import { getChannelStock, PROVIDERS, CHANNEL_PROVIDER, CHANNEL_LOGO } from "@/lib/integrations";
import { getAvailabilityEvents } from "@/lib/availability";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function FacilitiesPage() {
  await requireView("facilities");
  const [facilities, stock, rawByFacilityCode, movements, products, materials, facilityOptions, channelStock, { money, qty, date }, availability, finishedLines, latestPurchases, latestRawLayers] = await Promise.all([
    getFacilitiesDetailed(),
    getFinishedStock(),
    getRawStockByFacility(),
    getMovements(),
    getProducts(),
    getMaterialTypes(),
    getFacilities(),
    getChannelStock(),
    getFmt(),
    getAvailabilityEvents(),
    // Cost prefills for the adjustment form: newest finished-lot cost per product…
    prisma.lotLine.findMany({
      where: { status: "FINISHED" },
      select: { productId: true, cogPerUnit: true, finishedAt: true, lot: { select: { poDate: true, createdAt: true } } },
    }),
    // …and the latest purchase price per material (with layer movements as a fallback).
    prisma.purchase.findMany({
      where: { isAdjustment: false },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: { materialTypeId: true, unitCost: true },
    }),
    prisma.stockMovement.findMany({
      where: { itemType: "RAW", unitCost: { not: null } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: { materialTypeId: true, unitCost: true },
    }),
  ]);

  // Newest known cost per item, for prefilling "Cost per unit" on found stock / returns. Newest
  // = most recently FINISHED, not most recently ordered (lib/lot-status appearedAt).
  const productCost: Record<string, number> = {};
  for (const l of [...finishedLines].sort((a, b) => appearedAt(b, b.lot).getTime() - appearedAt(a, a.lot).getTime())) {
    if (!(l.productId in productCost)) productCost[l.productId] = l.cogPerUnit;
  }
  for (const p of products) {
    if (!(p.id in productCost) && p.openingUnitCost != null) productCost[p.id] = p.openingUnitCost;
  }
  const materialCost: Record<string, number> = {};
  for (const r of latestPurchases) {
    if (!(r.materialTypeId in materialCost)) materialCost[r.materialTypeId] = r.unitCost;
  }
  for (const r of latestRawLayers) {
    if (r.materialTypeId && !(r.materialTypeId in materialCost) && r.unitCost != null) materialCost[r.materialTypeId] = r.unitCost;
  }
  const todayISO = new Date().toISOString().slice(0, 10);

  // Channel facilities (Amazon FBA/AWD…) are integration-managed mirrors of a sales platform —
  // they get their own quiet section instead of mixing with the places you actually run.
  const physical = facilities.filter((f) => !f.channel);
  const channels = facilities.filter((f) => f.channel);
  // What each channel is holding, per its own platform's report (valued at cost).
  const channelHeld = new Map<string, { value: number; rows: typeof channelStock.rows }>();
  for (const r of channelStock.rows) {
    const cur = channelHeld.get(r.facilityId) ?? { value: 0, rows: [] };
    cur.value += r.value;
    cur.rows.push(r);
    channelHeld.set(r.facilityId, cur);
  }
  const codeToId = new Map(facilityOptions.map((f) => [f.code, f.id]));
  const materialIdByCode = new Map(materials.map((m) => [m.code, m.id]));
  const productIdByCode = new Map(products.map((p) => [p.code, p.id]));
  // Channel stock can be pulled BACK from in the movement form (Amazon removal orders etc.) —
  // listed per specific place ("Shopify — 638 Alton Place"); cost still draws from the channel's
  // shared pool (FBA + AWD collapse into AMAZON), the place is stamped for the history.
  const channelSources = channels.filter((f) => !f.inactive).map((f) => ({ id: f.id, name: f.name, channel: f.channel! }));

  // On-hand for the movement form: finished (per SKU) + raw (per material, and pool-SKU where relevant).
  const onHand: OnHandRow[] = [
    ...stock.rows.map((r) => ({ kind: "FINISHED" as const, itemId: r.productId, poolSku: null, poolSkuCode: null, facilityId: r.facilityId, units: r.units })),
    ...[...rawByFacilityCode.entries()].flatMap(([facCode, rows]) =>
      rows.map((r) => ({
        kind: "RAW" as const,
        itemId: materialIdByCode.get(r.code) ?? r.code,
        poolSku: r.sku ? productIdByCode.get(r.sku) ?? null : null,
        poolSkuCode: r.sku,
        facilityId: codeToId.get(facCode) ?? "",
        units: r.units,
      })),
    ),
  ];

  // Finished stock per facility (SKU rows + total), and raw stock per facility (material rows + total).
  type Held = { value: number; skus: { code: string; imageUrl: string | null; units: number; value: number }[] };
  const finByFacility = new Map<string, Held>();
  for (const r of stock.rows) {
    const cur = finByFacility.get(r.facilityId) ?? { value: 0, skus: [] };
    cur.value += r.value;
    cur.skus.push({ code: r.code, imageUrl: r.imageUrl, units: r.units, value: r.value });
    finByFacility.set(r.facilityId, cur);
  }
  for (const h of finByFacility.values()) h.skus.sort((a, b) => b.units - a.units);

  return (
    <>
      <PageHeader
        title="Facilities"
        subtitle="Everywhere your stock lives — co-packers, your own warehouses, and 3PLs you ship to."
      >
        <div className="flex flex-wrap items-center gap-2">
          {facilities.length > 0 && (products.length > 0 || materials.length > 0) && (
            <NewMovementPanel
              products={products.map((p) => ({ id: p.id, code: p.code, name: p.name, imageUrl: p.imageUrl }))}
              materials={materials.map((m) => ({ id: m.id, code: m.code, name: m.name, skuSpecific: m.skuSpecific, imageUrl: m.imageUrl }))}
              facilities={facilityOptions}
              onHand={onHand}
              todayISO={todayISO}
              channelFacilities={channelSources}
              costHints={{ products: productCost, materials: materialCost }}
              availability={availability}
            />
          )}
          {facilities.length > 0 && <NewFacilityButton />}
        </div>
      </PageHeader>

      {physical.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          title="No facilities yet"
          body="Add the places your stock is made or stored. You'll pick a facility when logging purchases and production, and both raw materials and finished stock are tracked separately at each one."
        >
          <NewFacilityButton />
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {physical.map((f) => {
            const fin = finByFacility.get(f.id);
            const raw = rawByFacilityCode.get(f.code) ?? [];
            const rawValue = raw.reduce((s, r) => s + r.value, 0);
            return (
              <Link key={f.id} href={`/facilities/${f.id}`} className="block">
                <Card className="flex h-full flex-col gap-3 transition-colors hover:border-accent-strong hover:bg-accent-soft/30">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      <Warehouse size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink">{f.code}</span>
                        <span className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-muted">
                          {facilityTypeLabel(f.type)}
                        </span>
                      </div>
                      <div className="truncate text-[12.5px] text-muted">{f.name}</div>
                      {isProductionSite(f.type) && (
                        <div className="mt-0.5 text-[11px] text-muted">
                          {f._count.lots} lots · {f._count.purchases} purchases · {f._count.purchaseOrders} POs
                        </div>
                      )}
                    </div>
                    <ChevronRight size={16} className="shrink-0 text-muted" />
                  </div>

                  {/* Finished + raw stock collapse to a hover popover so the cards stay compact. */}
                  <div className="mt-auto">
                    <StockSection label="Finished stock here" total={fin ? money(fin.value) : null}>
                      {fin?.skus.map((s) => (
                        <div key={s.code} className="flex items-center gap-2">
                          <SkuAvatar code={s.code} size={22} imageUrl={s.imageUrl} />
                          <span className="text-[12px] font-medium text-ink-soft">{s.code}</span>
                          <span className="tabular ml-auto whitespace-nowrap text-[12px] text-muted">
                            {qty(s.units)} {inflectUnit("unit", s.units)} · {money(s.value)}
                          </span>
                        </div>
                      ))}
                    </StockSection>

                    <StockSection label="Raw materials here" total={raw.length > 0 ? money(rawValue) : null}>
                      {raw.map((r, i) => (
                        <div key={`${r.code}-${r.sku ?? ""}-${i}`} className="flex items-center gap-2">
                          {r.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.imageUrl} alt={r.name} className="h-[22px] w-[22px] shrink-0 rounded-md border border-border object-cover" />
                          ) : (
                            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-muted">
                              <Package size={12} />
                            </span>
                          )}
                          <span className="truncate text-[12px] font-medium text-ink-soft">
                            {r.name}
                            {r.sku && <span className="text-muted"> · {r.sku}</span>}
                          </span>
                          <span className="tabular ml-auto whitespace-nowrap text-[12px] text-muted">
                            {qty(r.units)} {inflectUnit(materials.find((m) => m.code === r.code)?.unitLabel ?? "unit", r.units)} · {money(r.value)}
                          </span>
                        </div>
                      ))}
                    </StockSection>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Integration-managed mirrors of connected sales platforms — locked, read-only. */}
      {channels.length > 0 && (
        <div className="mt-8">
          <SectionTitle>Sales channels</SectionTitle>
          <p className="-mt-2 mb-3 text-[12.5px] text-muted">
            Created automatically by your connected platforms — they can&apos;t be edited or deleted here.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {channels.map((f) => (
              <Link key={f.id} href={`/facilities/${f.id}`} className="block">
                <Card className="flex h-full flex-col gap-3 transition-colors hover:border-accent-strong hover:bg-accent-soft/30">
                  <div className="flex items-center gap-3">
                    {f.channel && CHANNEL_LOGO[f.channel] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={CHANNEL_LOGO[f.channel]}
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-xl border border-border bg-white object-contain p-1"
                      />
                    ) : (
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                        <Plug size={18} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      {/* Channel facilities lead with the place ("638 Alton Place", "Amazon FBA")
                          and name the platform underneath — the code is a pill-sized handle used
                          in tables, not an identity anyone reads here. */}
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-ink">{f.name}</span>
                        {f.inactive && (
                          <span className="whitespace-nowrap rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-muted">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[12.5px] text-muted">
                        {f.channel ? (PROVIDERS[CHANNEL_PROVIDER[f.channel]]?.label ?? facilityTypeLabel(f.type)) : facilityTypeLabel(f.type)}
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-muted">
                      <Lock size={12} /> Managed
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-muted" />
                  </div>
                  <div className="mt-auto">
                    <StockSection label="Finished stock here" total={channelHeld.has(f.id) ? money(channelHeld.get(f.id)!.value) : null}>
                      {channelHeld.get(f.id)?.rows.map((s) => (
                        <div key={s.productId} className="flex items-center gap-2">
                          <SkuAvatar code={s.code} size={22} imageUrl={s.imageUrl} />
                          <span className="text-[12px] font-medium text-ink-soft">{s.code}</span>
                          <span className="tabular ml-auto whitespace-nowrap text-[12px] text-muted">
                            {qty(s.units)} {inflectUnit("unit", s.units)} · {money(s.value)}
                          </span>
                        </div>
                      ))}
                    </StockSection>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        <SectionTitle>Stock movements</SectionTitle>
        <p className="-mt-2 mb-3 text-[12.5px] text-muted">
          Where stock goes after it&apos;s made or bought — between your locations, out to a sales channel, to a customer, or
          written off. Raw materials can only move between facilities or be written off.
        </p>

        {stock.shortfalls.length > 0 && (
          <div className="mb-3 flex items-start gap-1.5 rounded-lg border tint-red px-3 py-2 text-[12px] text-negative">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              {stock.shortfalls.length} movement{stock.shortfalls.length === 1 ? "" : "s"} shipped more units than that
              location had on record. Check the quantities below.
            </span>
          </div>
        )}

        {movements.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No movements recorded yet"
            body="When stock leaves the place it was made or received — to a 3PL, to Amazon, to a customer, or written off — record it here so your inventory always shows where things actually are."
          />
        ) : (
          <MovementsLedger movements={movements} qty={qty} date={date} money={money} />
        )}
      </div>
    </>
  );
}
