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
import { getHandoffPlan, buildVirtualMovements, isVirtualMovement } from "@/lib/handoff";

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
  awaitingHandoff: number; // units counted virtually at Amazon (live shipment, no recorded movement)
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

export type RestockTotals = {
  raw: number;
  inProduction: number;
  fba: number;
  awd: number;
  amazon: number;
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
  const [products, snaps, lots, rawInv, settings, allProducts, movements, allFacilities, handoff] = await Promise.all([
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
    getHandoffPlan(),
  ]);
  // Lots whose cost is provisional (they carry an open ESTIMATE invoice) — their share of today's
  // value is recorded on the snapshot so history steps self-explain when estimates true up.
  // PO prices are informational only (never in COG), so TBD PO lines don't make a lot provisional.
  const estLotRows = await prisma.transaction.findMany({
    where: { lotId: { not: null }, invoice: { isEstimate: true } },
    select: { lotId: true },
  });
  const provisionalLotIds = new Set<string>(estLotRows.map((r) => r.lotId!));
  const snapByProduct = new Map(snaps.map((s) => [s.productId, s]));
  const lastSync = snaps.reduce<Date | null>((m, s) => (!m || s.capturedAt > m ? s.capturedAt : m), null);

  // Per-SKU: in-production units/value, soonest open-lot PO date, and finished lots.
  // Finished lot lines double as the finished-goods FIFO supply, at the facility that made them.
  const inProdUnits = new Map<string, number>();
  const inProdLines: { sku: string; units: number; cog: number; poMs: number; provisional: boolean }[] = [];
  const soonestPo = new Map<string, Date>();
  let inProductionValue = 0;
  let provisionalValue = 0; // v1 approximation: the in-production share of provisional lots
  const finishedLots = new Map<string, { units: number; cog: number; provisional: boolean }[]>();
  const supply: FinishedSupply[] = [];
  let supplySeq = 0;
  for (const lot of lots) {
    const poDate = lot.poDate ?? lot.createdAt;
    for (const ln of lot.lines) {
      if (lot.status === "IN_PRODUCTION") {
        inProdUnits.set(ln.productId, (inProdUnits.get(ln.productId) ?? 0) + ln.units);
        inProdLines.push({ sku: ln.productId, units: ln.units, cog: ln.cogPerUnit, poMs: poDate.getTime(), provisional: provisionalLotIds.has(lot.id) });
        inProductionValue += ln.units * ln.cogPerUnit;
        if (provisionalLotIds.has(lot.id)) provisionalValue += ln.units * ln.cogPerUnit;
        const cur = soonestPo.get(ln.productId);
        if (!cur || poDate < cur) soonestPo.set(ln.productId, poDate);
      } else {
        if (!finishedLots.has(ln.productId)) finishedLots.set(ln.productId, []);
        finishedLots.get(ln.productId)!.push({ units: ln.units, cog: ln.cogPerUnit, provisional: provisionalLotIds.has(lot.id) });
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

  // Where finished stock physically sits, and what left the network (and at what cost).
  const finishedMovements: FinishedMovement[] = movements.map((m, i) => ({
    id: m.id,
    sku: m.productId ?? "",
    fromFacilityId: m.fromFacilityId,
    toFacilityId: m.toFacilityId,
    toDestination: m.toDestination,
    quantity: m.quantity,
    date: m.date.getTime(),
    seq: i,
  }));
  // Virtual handoff drains (LOCKSTEP with computeFinishedGoods): live mirrored shipments whose
  // units nobody recorded leaving. They consume pools global-FIFO; whatever the pools can't cover
  // is deducted from IN_PRODUCTION lot lines oldest-first — Amazon's snapshot already counts those
  // units, so leaving them in production would count them twice (the batch-18 double count).
  const virtualMovements = buildVirtualMovements(handoff, supply);
  const virtualDate = new Map(virtualMovements.map((m) => [m.sku, m.date]));
  const finished = runFinishedGoodsEngine(supply, [...finishedMovements, ...virtualMovements]);

  for (const sf of finished.shortfalls) {
    if (!isVirtualMovement(sf.movementId)) continue;
    let remaining = sf.shortBy;
    for (const ln of inProdLines.filter((l) => l.sku === sf.sku).sort((a, b) => a.poMs - b.poMs)) {
      if (remaining <= 1e-6) break;
      const take = Math.min(ln.units, remaining);
      ln.units -= take;
      remaining -= take;
      inProdUnits.set(sf.sku, Math.max(0, (inProdUnits.get(sf.sku) ?? 0) - take));
      inProductionValue -= take * ln.cog;
      if (ln.provisional) provisionalValue -= take * ln.cog;
      // Valuation continuity: the deducted units' cost travels to the channel as a shipped layer,
      // so Amazon's stock is valued from them instead of jumping to the fallback cost.
      finished.shipped.push({
        sku: sf.sku,
        destination: "AMAZON",
        units: take,
        unitCost: ln.cog,
        date: virtualDate.get(sf.sku) ?? Date.now(),
      });
    }
    // Any remainder beyond production floors at zero — Amazon's bucket already carries the units.
  }

  // Amazon is valued from what was actually SHIPPED to Amazon — never from lots still sitting at
  // your own locations or already sold direct, which would double-count the same units' cost.
  const amazonLayers = new Map<string, ShippedLayer[]>();
  for (const l of finished.shipped) {
    if (l.destination !== "AMAZON") continue;
    if (!amazonLayers.has(l.sku)) amazonLayers.set(l.sku, []);
    amazonLayers.get(l.sku)!.push(l);
  }

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
    const awdTotal = (s?.awdOnhand ?? 0) + (s?.awdInbound ?? 0);
    const inProduction = inProdUnits.get(p.id) ?? 0;
    fbaUnits += fbaTotal;
    awdUnits += awdTotal;
    inProductionUnits += inProduction;

    // Value Amazon's reported units from what was actually shipped to Amazon, newest first —
    // FBA is filled before AWD from one shared pass so they can't draw the same units twice.
    // Anything beyond what we recorded shipping falls back to the newest lot cost.
    // Channel-residual fallback cost, most-trusted first: the SKU's deliberate standard cost
    // (day-one onboarding), else the newest finished lot with FINAL numbers, else a provisional
    // lot, else 0. A wild estimate on the newest lot can no longer become the org-wide basis.
    const lotsOf = finishedLots.get(p.id) ?? [];
    const fb = p.standardUnitCost ?? lotsOf.find((l) => !l.provisional)?.cog ?? lotsOf[0]?.cog ?? 0;
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
      awaitingHandoff: handoff.bySku.get(p.id)?.qty ?? 0,
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

  const grandTotal = rawInv.totalValue + inProductionValue + fbaValue + awdValue + atLocationsValue;
  const totals: RestockTotals = {
    raw: rawInv.totalValue,
    inProduction: inProductionValue,
    fba: fbaValue,
    awd: awdValue,
    amazon: fbaValue + awdValue,
    atLocations: atLocationsValue,
    total: grandTotal,
    fbaUnits,
    awdUnits,
    inProductionUnits,
    atLocationsUnits,
    monthlyCOGS,
    coverMonths: monthlyCOGS > 0 ? grandTotal / monthlyCOGS : 0,
  };

  await recordDailyInventoryValue(totals, settings.syncTz, provisionalValue);

  return {
    rows,
    lastSync,
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
  atLocations: number;
};

/** Daily inventory-value history (oldest → newest) for the dashboard charts, split by bucket. */
export async function getInventoryValueHistory(): Promise<ValueHistoryPoint[]> {
  return prisma.inventoryValueSnapshot.findMany({
    orderBy: { day: "asc" },
    select: { day: true, total: true, raw: true, inProduction: true, fba: true, awd: true, atLocations: true },
  });
}

/** Record today's inventory-value point (one row per calendar day, per org). Non-fatal.
 *  "Today" is the org's local calendar day (syncTz), not UTC — otherwise an org far from UTC
 *  records under tomorrow's date and its chart, month-to-date boundary and calendar read a day
 *  ahead of its own clock. */
async function recordDailyInventoryValue(t: RestockTotals, tz: string, provisionalValue = 0) {
  const day = localDay(tz);
  const values = { raw: t.raw, inProduction: t.inProduction, fba: t.fba, awd: t.awd, atLocations: t.atLocations, total: t.total, provisionalValue };
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
