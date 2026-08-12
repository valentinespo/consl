import { prisma } from "@/lib/prisma";
import { getInventory } from "@/lib/queries";
import { getOrgSettings } from "@/lib/settings";
import { localDay } from "@/lib/tz";
import {
  runFinishedGoodsEngine,
  valueChannelStock,
  type FinishedSupply,
  type FinishedMovement,
  type ShippedLayer,
} from "@/lib/finished-goods";

export type RestockRow = {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  fbaAvailable: number;
  fbaInbound: number;
  fbaReserved: number;
  fbaTotal: number;
  fbaValue: number; // those units at cost, valued newest-shipment-first (shared pass with AWD)
  awdOnhand: number;
  awdInbound: number;
  awdTotal: number;
  awdValue: number;
  inProduction: number;
  unitCost: number; // newest finished-lot cost per unit — what channel-held stock is valued at
  atLocations: number; // finished units sitting at your own facilities — made, just not shipped
  atLocationsBy: { code: string; units: number }[]; // where those units are, biggest first
  onHand: number; // fbaTotal + awdTotal (everything at Amazon, excluding production)
  soonestPoISO: string | null; // soonest open lot's PO date (fallback created date)
  units10d: number;
  units30d: number;
  units90d: number;
  salesDays10: number;
  salesDays30: number;
  salesDays90: number;
  dailySales: Record<string, number>; // { "YYYY-MM-DD": units }, trailing ~90 days
  salesEnd: string | null; // ISO anchor the daily series is measured to (sync time − 2d)
  windowDays: number | null; // per-SKU window override, null = use global toggle
  excludeDays: number | null; // OOS days to drop from the end of the window
  minMonths: number; // resolved floor (per-SKU override or global default)
  leadMonths: number; // resolved lead time
  rawMinMonths: number | null; // per-SKU override, null = using default
  rawLeadMonths: number | null;
  shipDays: number; // resolved shipping time, in days (per-SKU override or global default)
  rawShipDays: number | null; // per-SKU override, null = using the default
  shipBufferX: number; // global: start shipping at this multiple of the shipping time
  reorderToMonths: number; // resolved order size, in months of sales
  rawReorderToMonths: number | null; // per-SKU override, null = using the default
  batchSize: number; // resolved run size; 0 = don't round the order
  rawBatchSize: number | null; // per-SKU override, null = using the default
  sortIndex: number | null;
};

/** One (facility, product) cell of Shopify/TikTok-reported stock, valued from its channel's
 *  layer pool (opening balance + recorded shipments, newest first; overflow at newest lot cost). */
export type ChannelStockValued = {
  facilityId: string;
  productId: string;
  channel: string; // SHOPIFY | TIKTOK
  units: number;
  value: number;
};

export type RestockTotals = {
  raw: number;
  inProduction: number;
  fba: number;
  awd: number;
  amazon: number;
  shopify: number; // stock the Shopify locations report holding, valued at newest lot cost
  tiktok: number; // stock the TikTok warehouses report holding, valued at newest lot cost
  atLocations: number; // finished goods held at your own facilities / 3PLs
  total: number;
  fbaUnits: number;
  awdUnits: number;
  inProductionUnits: number;
  atLocationsUnits: number;
  monthlyCOGS: number; // blended monthly sell-through valued at cost
  coverMonths: number; // total inventory value ÷ monthlyCOGS = months of cover
};

export async function getRestock(): Promise<{
  rows: RestockRow[];
  lastSync: Date | null;
  totals: RestockTotals;
  channelStock: ChannelStockValued[]; // Shopify/TikTok stock per facility × SKU, layer-valued
  defaults: {
    minMonths: number;
    leadMonths: number;
    shipDays: number;
    shipBufferX: number;
    reorderTo: number;
    batchSize: number;
  };
  sortMode: string;
}> {
  const [products, snaps, lots, rawInv, settings, allProducts, movements, allFacilities] = await Promise.all([
    prisma.product.findMany({ where: { asin: { not: null } }, orderBy: { code: "asc" } }),
    prisma.skuSnapshot.findMany({ distinct: ["productId"], orderBy: { capturedAt: "desc" } }),
    prisma.lot.findMany({ include: { lines: true }, orderBy: [{ poDate: "desc" }, { createdAt: "desc" }] }),
    getInventory(),
    getOrgSettings(),
    // Finished-goods stock covers EVERY product, not just the Amazon-mapped ones — a customer
    // who doesn't sell on Amazon still holds inventory.
    prisma.product.findMany({ orderBy: { code: "asc" } }),
    prisma.stockMovement.findMany({ where: { itemType: "FINISHED" }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
    prisma.facility.findMany({ select: { id: true, code: true } }),
  ]);
  const snapByProduct = new Map(snaps.map((s) => [s.productId, s]));
  const lastSync = snaps.reduce<Date | null>((m, s) => (!m || s.capturedAt > m ? s.capturedAt : m), null);

  // Per-SKU: in-production units/value, soonest open-lot PO date, and finished lots.
  // Finished lot lines double as the finished-goods FIFO supply, at the facility that made them.
  const inProdUnits = new Map<string, number>();
  const soonestPo = new Map<string, Date>();
  let inProductionValue = 0;
  const finishedLots = new Map<string, { units: number; cog: number }[]>();
  const supply: FinishedSupply[] = [];
  let supplySeq = 0;
  for (const lot of lots) {
    const poDate = lot.poDate ?? lot.createdAt;
    for (const ln of lot.lines) {
      // Status is per LINE — a finished SKU becomes sellable stock while its lot-mates cook.
      if (ln.status === "IN_PRODUCTION") {
        inProdUnits.set(ln.productId, (inProdUnits.get(ln.productId) ?? 0) + ln.units);
        inProductionValue += ln.units * ln.cogPerUnit;
        const cur = soonestPo.get(ln.productId);
        if (!cur || poDate < cur) soonestPo.set(ln.productId, poDate);
      } else {
        if (!finishedLots.has(ln.productId)) finishedLots.set(ln.productId, []);
        finishedLots.get(ln.productId)!.push({ units: ln.units, cog: ln.cogPerUnit });
        supply.push({
          sku: ln.productId,
          facilityId: lot.facilityId,
          units: ln.units,
          unitCost: ln.cogPerUnit,
          date: poDate.getTime(),
          seq: supplySeq++,
        });
      }
    }
  }

  // Opening balances (kind OPENING) are day-zero layers, not movements. At one of YOUR facilities
  // they are finished SUPPLY — like a lot line, at the operator-entered starting COG. At a sales
  // channel they are a day-zero shipped layer: units already sitting there when consl started,
  // which the newest-first valuation naturally consumes LAST — i.e. they're the first stock sold
  // through, and once gone they never touch the value of real production that follows.
  const openingChannelLayers: ShippedLayer[] = [];
  for (const m of movements) {
    if (m.kind !== "OPENING" || !m.productId || !(m.quantity > 0)) continue;
    if (m.toFacilityId) {
      supply.push({
        sku: m.productId,
        facilityId: m.toFacilityId,
        units: m.quantity,
        unitCost: m.unitCost ?? 0,
        date: m.date.getTime(),
        seq: supplySeq++,
      });
    } else if (m.toDestination) {
      openingChannelLayers.push({ sku: m.productId, destination: m.toDestination, units: m.quantity, unitCost: m.unitCost ?? 0, date: m.date.getTime() });
    }
  }

  // Where finished stock physically sits, and what left the network (and at what cost).
  const finishedMovements: FinishedMovement[] = movements
    .filter((m) => m.kind !== "OPENING" && m.fromFacilityId)
    .map((m, i) => ({
      id: m.id,
      sku: m.productId ?? "",
      fromFacilityId: m.fromFacilityId!,
      toFacilityId: m.toFacilityId,
      toDestination: m.toDestination,
      quantity: m.quantity,
      date: m.date.getTime(),
      seq: i,
    }));
  const finished = runFinishedGoodsEngine(supply, finishedMovements);

  // A channel is valued from what actually ENTERED that channel — its day-zero opening layer plus
  // every shipment recorded to it — never from lots still sitting at your own locations or already
  // sold direct, which would double-count the same units' cost. One layer stack per channel per SKU.
  const channelLayers = new Map<string, Map<string, ShippedLayer[]>>();
  const addChannelLayer = (l: ShippedLayer) => {
    const perSku = channelLayers.get(l.destination) ?? new Map<string, ShippedLayer[]>();
    if (!channelLayers.has(l.destination)) channelLayers.set(l.destination, perSku);
    const list = perSku.get(l.sku) ?? [];
    if (!perSku.has(l.sku)) perSku.set(l.sku, list);
    list.push(l);
  };
  for (const l of finished.shipped) addChannelLayer(l);
  for (const l of openingChannelLayers) addChannelLayer(l);
  const amazonLayers = channelLayers.get("AMAZON") ?? new Map<string, ShippedLayer[]>();

  // Newest-lot cost per product, falling back to the onboarding COG until the first real lot
  // exists — the unit cost channel stock beyond recorded layers is valued at. Covers EVERY
  // product (a Shopify-only SKU has no ASIN but still holds channel stock).
  const openingCostById = new Map(allProducts.map((p) => [p.id, p.openingUnitCost]));
  const costFor = (productId: string) => finishedLots.get(productId)?.[0]?.cog ?? openingCostById.get(productId) ?? 0;

  // Finished goods still held at your own facilities — the bucket that was previously invisible.
  const atLocationsValue = finished.pools.reduce((s, p) => s + p.value, 0);
  const atLocationsUnits = finished.pools.reduce((s, p) => s + p.units, 0);

  // Per-SKU: how many finished units are sitting at your own locations, and where.
  const facilityCode = new Map(allFacilities.map((f) => [f.id, f.code]));
  const heldBySku = new Map<string, { units: number; by: { code: string; units: number }[] }>();
  for (const p of finished.pools) {
    const cur = heldBySku.get(p.sku) ?? { units: 0, by: [] };
    cur.units += p.units;
    cur.by.push({ code: facilityCode.get(p.facilityId) ?? "?", units: p.units });
    heldBySku.set(p.sku, cur);
  }
  for (const h of heldBySku.values()) h.by.sort((a, b) => b.units - a.units);

  let fbaValue = 0;
  let awdValue = 0;
  let fbaUnits = 0;
  let awdUnits = 0;
  let inProductionUnits = 0;
  let monthlyCOGS = 0; // Σ monthly units sold × newest lot cost → blended sell-through at cost
  const rows: RestockRow[] = products.map((p) => {
    const s = snapByProduct.get(p.id);
    const fbaTotal = s?.fbaTotal ?? 0;
    // Reserved-in-AWD units are picked for an FBA replenishment, and Amazon creates the FBA
    // inbound shipment the moment the replenishment exists — so they already sit in fbaTotal.
    // Subtracting them here is what keeps a replenishment from counting twice while it's staged.
    const awdTotal = Math.max(0, (s?.awdOnhand ?? 0) - (s?.awdReserved ?? 0)) + (s?.awdInbound ?? 0);
    const inProduction = inProdUnits.get(p.id) ?? 0;
    fbaUnits += fbaTotal;
    awdUnits += awdTotal;
    inProductionUnits += inProduction;

    // Value Amazon's reported units from what was actually shipped to Amazon, newest first —
    // FBA is filled before AWD from one shared pass so they can't draw the same units twice.
    // Anything beyond what we recorded shipping falls back to the newest lot cost.
    const fb = costFor(p.id);
    const [fbaVal, awdVal] = valueChannelStock(amazonLayers.get(p.id) ?? [], [fbaTotal, awdTotal], fb);
    fbaValue += fbaVal;
    awdValue += awdVal;
    monthlyCOGS += ((s?.units90d ?? 0) / 90) * 30.44 * fb; // blended 90-day sell-through × unit cost

    return {
      id: p.id,
      code: p.code,
      name: p.name,
      imageUrl: p.imageUrl,
      fbaAvailable: s?.fbaAvailable ?? 0,
      fbaInbound: s?.fbaInbound ?? 0,
      fbaReserved: s?.fbaReserved ?? 0,
      fbaTotal,
      fbaValue: fbaVal,
      awdOnhand: s?.awdOnhand ?? 0,
      awdInbound: s?.awdInbound ?? 0,
      awdTotal,
      awdValue: awdVal,
      inProduction,
      unitCost: fb,
      atLocations: heldBySku.get(p.id)?.units ?? 0,
      atLocationsBy: heldBySku.get(p.id)?.by ?? [],
      onHand: fbaTotal + awdTotal,
      soonestPoISO: soonestPo.get(p.id)?.toISOString() ?? null,
      units10d: s?.units10d ?? 0,
      units30d: s?.units30d ?? 0,
      units90d: s?.units90d ?? 0,
      salesDays10: s?.salesDays10 ?? 0,
      salesDays30: s?.salesDays30 ?? 0,
      salesDays90: s?.salesDays90 ?? 0,
      dailySales: (s?.dailySales as Record<string, number> | null) ?? {},
      salesEnd: s?.salesEnd ? s.salesEnd.toISOString() : null,
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
  });

  // Stock the other channels report holding (synced into ChannelStock per facility), valued
  // exactly like Amazon: from the layers that actually entered THAT channel (starting balance +
  // recorded shipments), newest first. One shared pass per channel × SKU, so a channel's several
  // facilities can never draw the same layer twice — the whole channel is ONE pool, per the
  // founder's design. Units beyond any recorded layer fall back to the newest lot cost.
  const channelHeld = await prisma.channelStock.findMany({
    where: { units: { gt: 0 } },
    select: { productId: true, facilityId: true, units: true, facility: { select: { channel: true, code: true } } },
    orderBy: [{ facility: { code: "asc" } }, { productId: "asc" }],
  });
  const channelGroups = new Map<string, { channel: string; productId: string; cells: { facilityId: string; units: number }[] }>();
  for (const c of channelHeld) {
    const ch = c.facility.channel;
    if (ch !== "SHOPIFY" && ch !== "TIKTOK") continue; // Amazon never lives in ChannelStock
    const k = `${ch}|${c.productId}`;
    const cur = channelGroups.get(k) ?? { channel: ch, productId: c.productId, cells: [] };
    if (!channelGroups.has(k)) channelGroups.set(k, cur);
    cur.cells.push({ facilityId: c.facilityId, units: c.units });
  }
  const channelStock: ChannelStockValued[] = [];
  for (const g of channelGroups.values()) {
    const layers = channelLayers.get(g.channel)?.get(g.productId) ?? [];
    const values = valueChannelStock(
      layers,
      g.cells.map((c) => c.units),
      costFor(g.productId),
    );
    g.cells.forEach((c, i) =>
      channelStock.push({ facilityId: c.facilityId, productId: g.productId, channel: g.channel, units: c.units, value: values[i] }),
    );
  }
  let shopifyValue = 0;
  let tiktokValue = 0;
  for (const v of channelStock) {
    if (v.channel === "SHOPIFY") shopifyValue += v.value;
    else tiktokValue += v.value;
  }

  const grandTotal = rawInv.totalValue + inProductionValue + fbaValue + awdValue + shopifyValue + tiktokValue + atLocationsValue;
  const totals: RestockTotals = {
    raw: rawInv.totalValue,
    inProduction: inProductionValue,
    fba: fbaValue,
    awd: awdValue,
    amazon: fbaValue + awdValue,
    shopify: shopifyValue,
    tiktok: tiktokValue,
    atLocations: atLocationsValue,
    total: grandTotal,
    fbaUnits,
    awdUnits,
    inProductionUnits,
    atLocationsUnits,
    monthlyCOGS,
    coverMonths: monthlyCOGS > 0 ? grandTotal / monthlyCOGS : 0,
  };

  await recordDailyInventoryValue(totals, settings.syncTz);

  return {
    rows,
    lastSync,
    channelStock,
    sortMode: settings.sortMode,
    defaults: {
      minMonths: settings.defaultMinMonths,
      leadMonths: settings.defaultLeadMonths,
      shipDays: settings.shipDays,
      shipBufferX: settings.shipBufferX,
      reorderTo: settings.defaultReorderTo,
      batchSize: settings.defaultBatchSize,
    },
    totals,
  };
}

export type ValueHistoryPoint = {
  day: string;
  total: number;
  raw: number;
  inProduction: number;
  fba: number;
  awd: number;
  shopify: number;
  tiktok: number;
  atLocations: number;
};

/** Daily inventory-value history (oldest → newest) for the dashboard charts, split by bucket. */
export async function getInventoryValueHistory(): Promise<ValueHistoryPoint[]> {
  return prisma.inventoryValueSnapshot.findMany({
    orderBy: { day: "asc" },
    select: { day: true, total: true, raw: true, inProduction: true, fba: true, awd: true, shopify: true, tiktok: true, atLocations: true },
  });
}

/** Record today's inventory-value point (one row per calendar day, per org). Non-fatal.
 *  "Today" is the org's local calendar day (syncTz), not UTC — otherwise an org far from UTC
 *  records under tomorrow's date and its chart, month-to-date boundary and calendar read a day
 *  ahead of its own clock. */
async function recordDailyInventoryValue(t: RestockTotals, tz: string) {
  const day = localDay(tz);
  const values = { raw: t.raw, inProduction: t.inProduction, fba: t.fba, awd: t.awd, shopify: t.shopify, tiktok: t.tiktok, atLocations: t.atLocations, total: t.total };
  try {
    const existing = await prisma.inventoryValueSnapshot.findFirst({ where: { day } }); // auto-scoped to org
    if (existing) {
      await prisma.inventoryValueSnapshot.update({ where: { id: existing.id }, data: { ...values, capturedAt: new Date() } });
    } else {
      await prisma.inventoryValueSnapshot.create({ data: { day, ...values } });
    }
  } catch {
    // swallow: recording history must never break the dashboard
  }
}
