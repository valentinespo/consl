import { prisma } from "@/lib/prisma";
import { getInventory } from "@/lib/queries";

export type RestockRow = {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  fbaAvailable: number;
  fbaInbound: number;
  fbaReserved: number; // reserved + in-transit-between-FCs + researching (so avail+inbound+reserved = fbaTotal)
  fbaTotal: number;
  awdOnhand: number;
  awdInbound: number;
  awdTotal: number;
  inProduction: number;
  position: number; // fbaTotal + awdTotal + inProduction
  units10d: number;
  units30d: number;
  units90d: number;
  minMonths: number;
  reorderToMonths: number;
  batchSize: number;
  amazonValue: number; // reverse-FIFO COG of FBA + AWD units
};

export type RestockTotals = {
  raw: number;
  inProduction: number;
  amazon: number;
  total: number;
  fbaUnits: number;
  awdUnits: number;
  inProductionUnits: number;
};

/** Per-SKU raw position numbers + window sales + total inventory value. Window-dependent
 * metrics (velocity, cover, status) are computed client-side so the 10/30/90-day toggle is instant. */
export async function getRestock(): Promise<{ rows: RestockRow[]; totals: RestockTotals; lastSync: Date | null }> {
  const [products, snaps, lots, rawInv] = await Promise.all([
    prisma.product.findMany({ where: { asin: { not: null } }, orderBy: { code: "asc" } }),
    prisma.skuSnapshot.findMany({ distinct: ["productId"], orderBy: { capturedAt: "desc" } }),
    prisma.lot.findMany({ include: { lines: true }, orderBy: [{ poDate: "desc" }, { createdAt: "desc" }] }),
    getInventory(),
  ]);
  const snapByProduct = new Map(snaps.map((s) => [s.productId, s]));
  const lastSync = snaps.reduce<Date | null>((m, s) => (!m || s.capturedAt > m ? s.capturedAt : m), null);

  const inProdUnits = new Map<string, number>();
  let inProductionValue = 0;
  const finishedLots = new Map<string, { units: number; cog: number }[]>();
  for (const lot of lots) {
    for (const ln of lot.lines) {
      if (lot.status === "IN_PRODUCTION") {
        inProdUnits.set(ln.productId, (inProdUnits.get(ln.productId) ?? 0) + ln.units);
        inProductionValue += ln.units * ln.cogPerUnit;
      } else {
        if (!finishedLots.has(ln.productId)) finishedLots.set(ln.productId, []);
        finishedLots.get(ln.productId)!.push({ units: ln.units, cog: ln.cogPerUnit });
      }
    }
  }

  let amazon = 0;
  let fbaUnits = 0;
  let awdUnits = 0;
  let inProductionUnits = 0;
  const rows: RestockRow[] = products.map((p) => {
    const s = snapByProduct.get(p.id);
    const fbaTotal = s?.fbaTotal ?? 0;
    const awdTotal = (s?.awdOnhand ?? 0) + (s?.awdInbound ?? 0);
    const inProduction = inProdUnits.get(p.id) ?? 0;
    const position = fbaTotal + awdTotal + inProduction;
    fbaUnits += fbaTotal;
    awdUnits += awdTotal;
    inProductionUnits += inProduction;

    // Reverse-FIFO: units still at Amazon (FBA + AWD) are the newest produced → cost newest-lot-first.
    let need = fbaTotal + awdTotal;
    let val = 0;
    for (const l of finishedLots.get(p.id) ?? []) {
      if (need <= 0) break;
      const take = Math.min(need, l.units);
      val += take * l.cog;
      need -= take;
    }
    if (need > 0) val += need * (finishedLots.get(p.id)?.[0]?.cog ?? 0);
    amazon += val;

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
      position,
      units10d: s?.units10d ?? 0,
      units30d: s?.units30d ?? 0,
      units90d: s?.units90d ?? 0,
      minMonths: p.minMonths ?? 5,
      reorderToMonths: p.reorderToMonths ?? 12,
      batchSize: p.batchSize ?? 0,
      amazonValue: val,
    };
  });

  return {
    rows,
    lastSync,
    totals: {
      raw: rawInv.totalValue,
      inProduction: inProductionValue,
      amazon,
      total: rawInv.totalValue + inProductionValue + amazon,
      fbaUnits,
      awdUnits,
      inProductionUnits,
    },
  };
}
