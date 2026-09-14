import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { getOrgSettings } from "@/lib/settings";
import { getRestock, type RestockRow } from "@/lib/restock";
import { getStockRoutes, type StockRoute } from "@/lib/stock-routes";
import { activeExclusions } from "@/lib/order-metrics";
import type { Place, PlaceKind, PlaceStock, Reorder2Row } from "@/lib/reorder2-engine";

/**
 * Reorder 2.0 data: every product (not only the Amazon-mapped ones), with its stock and its sales
 * velocity per place, the production runs per facility, and the routes in force. The pure engine
 * (lib/reorder2-engine.ts) turns this into statuses and suggestions on the client.
 */

const VELOCITY_DAYS = 95; // a 90-day window measured to two days ago, with slack

export type Reorder2Data = {
  rows: Reorder2Row[];
  places: Place[];
  routes: StockRoute[];
  routesSaved: boolean;
  lastSync: Date | null;
  defaults: { minMonths: number; leadMonths: number; shipDays: number; shipBufferX: number; reorderTo: number; batchSize: number };
  sortMode: string;
  nowMs: number;
};

export async function getReorder2(): Promise<Reorder2Data> {
  const orgId = await getCurrentOrgId();
  const [restock, settings, routing, products, ex] = await Promise.all([
    getRestock(),
    getOrgSettings(),
    getStockRoutes(),
    prisma.product.findMany({ orderBy: { code: "asc" } }),
    activeExclusions(),
  ]);
  const tz = settings.syncTz;

  // Units shipped per product, per place, per company-calendar day — the velocity of every place.
  // Exactly the orders the Orders tab and the P&L count: never cancelled or voided ones, never a
  // mirrored copy or an Amazon MCF twin of another channel's sale (activeExclusions), and never an
  // order with no facility — consl can't tell which place sold it, so it counts nowhere until
  // someone places it (the Orders tab flags them).
  const since = new Date(Date.now() - VELOCITY_DAYS * 86_400_000);
  const sold = await prisma.$queryRaw<{ productId: string; facility: string; d: string; units: number }[]>`
    SELECT l."productId", COALESCE(o."fulfillmentOverrideFacilityId", o."fulfillmentFacilityId") AS facility,
      to_char(o."orderedAt" AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d, SUM(l.quantity)::int AS units
    FROM "SalesOrderLine" l JOIN "SalesOrder" o ON o.id = l."orderId"
    WHERE o."orgId" = ${orgId} AND l."productId" IS NOT NULL AND o.cancelled = false AND o.voided = false
      AND COALESCE(o."fulfillmentOverrideFacilityId", o."fulfillmentFacilityId") IS NOT NULL
      AND NOT (o.channel = 'SHOPIFY' AND o.source = ANY(${ex.sources}))
      AND NOT (${ex.mcf}::boolean AND o.mcf)
      AND o."orderedAt" >= ${since}
    GROUP BY 1, 2, 3`;
  const daily = new Map<string, Record<string, number>>(); // productId|placeId → day → units
  for (const r of sold) {
    const k = `${r.productId}|${r.facility}`;
    const cur = daily.get(k) ?? {};
    cur[r.d] = (cur[r.d] ?? 0) + r.units;
    daily.set(k, cur);
  }

  const kindOf = (channel: string | null): PlaceKind =>
    channel === "AMAZON_FBA" ? "AMAZON_FBA" : channel === "AMAZON_AWD" ? "AMAZON_AWD" : channel === "SHOPIFY" ? "SHOPIFY" : channel === "TIKTOK" ? "TIKTOK" : "own";
  const places: Place[] = routing.facilities.map((f) => ({ id: f.id, code: f.code, name: f.name, kind: kindOf(f.channel) }));
  const fbaId = places.find((p) => p.kind === "AMAZON_FBA")?.id ?? null;
  const awdId = places.find((p) => p.kind === "AMAZON_AWD")?.id ?? null;

  const ownBy = new Map<string, Map<string, number>>();
  for (const c of restock.ownStock) ownBy.set(c.productId, new Map([...(ownBy.get(c.productId) ?? []), [c.facilityId, c.units]]));
  const channelBy = new Map<string, Map<string, number>>();
  for (const c of restock.channelStock) channelBy.set(c.productId, new Map([...(channelBy.get(c.productId) ?? []), [c.facilityId, c.units]]));
  const prodBy = new Map<string, Reorder2Row["inProductionBy"]>();
  for (const c of restock.inProductionBy) prodBy.set(c.productId, [...(prodBy.get(c.productId) ?? []), { facilityId: c.facilityId, units: c.units, soonestPoISO: c.soonestPoISO }]);
  const restockById = new Map(restock.rows.map((r) => [r.id, r]));

  const rows: Reorder2Row[] = products.map((p) => {
    const base: RestockRow = restockById.get(p.id) ?? {
      id: p.id,
      code: p.code,
      name: p.name,
      imageUrl: p.imageUrl,
      fbaAvailable: 0, fbaInbound: 0, fbaReserved: 0, fbaTotal: 0, fbaValue: 0,
      awdOnhand: 0, awdInbound: 0, awdTotal: 0, awdValue: 0,
      inProduction: (prodBy.get(p.id) ?? []).reduce((t, x) => t + x.units, 0),
      unitCost: 0,
      atLocations: [...(ownBy.get(p.id) ?? new Map<string, number>()).values()].reduce((t, u) => t + u, 0),
      atLocationsBy: [],
      onHand: 0,
      soonestPoISO: (prodBy.get(p.id) ?? []).map((x) => x.soonestPoISO).filter((x): x is string => !!x).sort()[0] ?? null,
      units10d: 0, units30d: 0, units90d: 0, salesDays10: 0, salesDays30: 0, salesDays90: 0,
      dailySales: {},
      salesEnd: null,
      windowDays: p.windowDays,
      excludeDays: p.excludeDays,
      minMonths: p.minMonths ?? settings.defaultMinMonths,
      leadMonths: p.leadMonths ?? settings.defaultLeadMonths,
      rawMinMonths: p.minMonths,
      rawLeadMonths: p.leadMonths,
      shipDays: p.shipDays ?? settings.shipDays,
      rawShipDays: p.shipDays,
      shipBufferX: settings.shipBufferX,
      reorderToMonths: p.reorderToMonths ?? settings.defaultReorderTo,
      rawReorderToMonths: p.reorderToMonths,
      batchSize: p.batchSize ?? settings.defaultBatchSize,
      rawBatchSize: p.batchSize,
      sortIndex: p.sortIndex,
    };
    const cells: PlaceStock[] = [];
    const seen = new Set<string>();
    const push = (placeId: string, sellable: number, inbound: number) => {
      const sales = daily.get(`${p.id}|${placeId}`) ?? {};
      if (sellable <= 0 && inbound <= 0 && Object.keys(sales).length === 0) return;
      seen.add(placeId);
      cells.push({ placeId, sellable, inbound, dailySales: sales });
    };
    // Amazon's places come from the FBA/AWD snapshot; AWD's reserved units already sit in FBA's
    // inbound (see getRestock), so AWD shows what is actually still there.
    if (fbaId) push(fbaId, base.fbaAvailable + base.fbaReserved, base.fbaInbound);
    if (awdId) push(awdId, Math.max(0, base.awdTotal - base.awdInbound), base.awdInbound);
    for (const [facilityId, units] of ownBy.get(p.id) ?? []) push(facilityId, units, 0);
    for (const [facilityId, units] of channelBy.get(p.id) ?? []) if (!seen.has(facilityId)) push(facilityId, units, 0);
    // Places with sales but no stock at all (a location Shopify reports empty, a warehouse sold out).
    for (const k of daily.keys()) {
      const [productId, placeId] = k.split("|");
      if (productId !== p.id || seen.has(placeId)) continue;
      if (places.some((pl) => pl.id === placeId)) push(placeId, 0, 0);
    }
    return { ...base, places: cells, inProductionBy: prodBy.get(p.id) ?? [] };
  });

  return {
    rows,
    places,
    routes: routing.routes,
    routesSaved: routing.saved,
    lastSync: restock.lastSync,
    defaults: restock.defaults,
    sortMode: restock.sortMode,
    nowMs: Date.now(),
  };
}
