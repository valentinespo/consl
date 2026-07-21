import { prisma } from "@/lib/prisma";
import { getInventory } from "@/lib/queries";

export type RestockRow = {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  fbaAvailable: number;
  fbaInbound: number;
  fbaReserved: number;
  fbaTotal: number;
  awdOnhand: number;
  awdInbound: number;
  awdTotal: number;
  inProduction: number;
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
  reorderToMonths: number;
  batchSize: number;
  sortIndex: number | null;
};

export type RestockTotals = {
  raw: number;
  inProduction: number;
  fba: number;
  awd: number;
  amazon: number;
  total: number;
  fbaUnits: number;
  awdUnits: number;
  inProductionUnits: number;
  monthlyCOGS: number; // blended monthly sell-through valued at cost
  coverMonths: number; // total inventory value ÷ monthlyCOGS = months of cover
};

export async function getRestock(): Promise<{
  rows: RestockRow[];
  lastSync: Date | null;
  totals: RestockTotals;
  defaults: { minMonths: number; leadMonths: number };
  sortMode: string;
}> {
  const [products, snaps, lots, rawInv, settings] = await Promise.all([
    prisma.product.findMany({ where: { asin: { not: null } }, orderBy: { code: "asc" } }),
    prisma.skuSnapshot.findMany({ distinct: ["productId"], orderBy: { capturedAt: "desc" } }),
    prisma.lot.findMany({ include: { lines: true }, orderBy: [{ poDate: "desc" }, { createdAt: "desc" }] }),
    getInventory(),
    prisma.settings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {} }),
  ]);
  const snapByProduct = new Map(snaps.map((s) => [s.productId, s]));
  const lastSync = snaps.reduce<Date | null>((m, s) => (!m || s.capturedAt > m ? s.capturedAt : m), null);

  // Per-SKU: in-production units/value, soonest open-lot PO date, and finished lots (reverse-FIFO).
  const inProdUnits = new Map<string, number>();
  const soonestPo = new Map<string, Date>();
  let inProductionValue = 0;
  const finishedLots = new Map<string, { units: number; cog: number }[]>();
  for (const lot of lots) {
    const poDate = lot.poDate ?? lot.createdAt;
    for (const ln of lot.lines) {
      if (lot.status === "IN_PRODUCTION") {
        inProdUnits.set(ln.productId, (inProdUnits.get(ln.productId) ?? 0) + ln.units);
        inProductionValue += ln.units * ln.cogPerUnit;
        const cur = soonestPo.get(ln.productId);
        if (!cur || poDate < cur) soonestPo.set(ln.productId, poDate);
      } else {
        if (!finishedLots.has(ln.productId)) finishedLots.set(ln.productId, []);
        finishedLots.get(ln.productId)!.push({ units: ln.units, cog: ln.cogPerUnit });
      }
    }
  }

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

    // Reverse-FIFO value: cost FBA first, then AWD, newest lot first.
    let needFba = fbaTotal;
    let needAwd = awdTotal;
    let fbaVal = 0;
    let awdVal = 0;
    for (const l of finishedLots.get(p.id) ?? []) {
      if (needFba <= 0 && needAwd <= 0) break;
      let avail = l.units;
      if (needFba > 0 && avail > 0) {
        const t = Math.min(needFba, avail);
        fbaVal += t * l.cog;
        needFba -= t;
        avail -= t;
      }
      if (needAwd > 0 && avail > 0) {
        const t = Math.min(needAwd, avail);
        awdVal += t * l.cog;
        needAwd -= t;
      }
    }
    const fb = finishedLots.get(p.id)?.[0]?.cog ?? 0;
    if (needFba > 0) fbaVal += needFba * fb;
    if (needAwd > 0) awdVal += needAwd * fb;
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
      awdOnhand: s?.awdOnhand ?? 0,
      awdInbound: s?.awdInbound ?? 0,
      awdTotal,
      inProduction,
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
      reorderToMonths: p.reorderToMonths ?? 12,
      batchSize: p.batchSize ?? 0,
      sortIndex: p.sortIndex,
    };
  });

  const totals: RestockTotals = {
    raw: rawInv.totalValue,
    inProduction: inProductionValue,
    fba: fbaValue,
    awd: awdValue,
    amazon: fbaValue + awdValue,
    total: rawInv.totalValue + inProductionValue + fbaValue + awdValue,
    fbaUnits,
    awdUnits,
    inProductionUnits,
    monthlyCOGS,
    coverMonths: monthlyCOGS > 0 ? (rawInv.totalValue + inProductionValue + fbaValue + awdValue) / monthlyCOGS : 0,
  };

  await recordDailyInventoryValue(totals);

  return {
    rows,
    lastSync,
    sortMode: settings.sortMode,
    defaults: { minMonths: settings.defaultMinMonths, leadMonths: settings.defaultLeadMonths },
    totals,
  };
}

export type ValueHistoryPoint = { day: string; total: number; raw: number; inProduction: number; fba: number; awd: number };

/** Daily inventory-value history (oldest → newest) for the dashboard charts, split by bucket. */
export async function getInventoryValueHistory(): Promise<ValueHistoryPoint[]> {
  return prisma.inventoryValueSnapshot.findMany({
    orderBy: { day: "asc" },
    select: { day: true, total: true, raw: true, inProduction: true, fba: true, awd: true },
  });
}

/** Upsert today's inventory-value point (one row per calendar day). Non-fatal — never breaks a render. */
async function recordDailyInventoryValue(t: RestockTotals) {
  const day = new Date().toISOString().slice(0, 10);
  try {
    await prisma.inventoryValueSnapshot.upsert({
      where: { day },
      create: { day, raw: t.raw, inProduction: t.inProduction, fba: t.fba, awd: t.awd, total: t.total },
      update: { raw: t.raw, inProduction: t.inProduction, fba: t.fba, awd: t.awd, total: t.total, capturedAt: new Date() },
    });
  } catch {
    // swallow: recording history must never break the dashboard
  }
}
