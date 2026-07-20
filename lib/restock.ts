import { prisma } from "@/lib/prisma";
import { getInventory } from "@/lib/queries";

const MONTH = 30.44; // avg days/month

export type RestockRow = {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  fbaAvailable: number;
  fbaInbound: number;
  fbaReserved: number;
  fbaTotal: number;
  inProduction: number;
  position: number;
  monthly: number; // units/month, 90-day avg
  cover: number; // months of cover
  minMonths: number;
  status: "reorder" | "watch" | "ok";
  recommendedQty: number;
  amazonValue: number; // reverse-FIFO COG of the FBA units
};

/** The restock dashboard model: per-SKU position, velocity, cover, recommendations + total inventory value. */
export async function getRestock() {
  const [products, snaps, lots, rawInv] = await Promise.all([
    prisma.product.findMany({ where: { asin: { not: null } }, orderBy: { code: "asc" } }),
    prisma.skuSnapshot.findMany({ distinct: ["productId"], orderBy: { capturedAt: "desc" } }),
    prisma.lot.findMany({
      include: { lines: true },
      orderBy: [{ poDate: "desc" }, { createdAt: "desc" }],
    }),
    getInventory(),
  ]);
  const snapByProduct = new Map(snaps.map((s) => [s.productId, s]));
  const lastSync = snaps.reduce<Date | null>((m, s) => (!m || s.capturedAt > m ? s.capturedAt : m), null);

  // Per-SKU: in-production units/value, and finished lots newest-first (for reverse-FIFO Amazon costing).
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

  let amazonValue = 0;
  const rows: RestockRow[] = products.map((p) => {
    const s = snapByProduct.get(p.id);
    const fbaTotal = s?.fbaTotal ?? 0;
    const units90 = s?.units90d ?? 0;
    const inProduction = inProdUnits.get(p.id) ?? 0;
    const position = fbaTotal + inProduction;
    const monthly = (units90 / 90) * MONTH;
    const cover = monthly > 0 ? position / monthly : position > 0 ? 999 : 0;
    const minMonths = p.minMonths ?? 5;

    // Reverse-FIFO: the units still at FBA are the newest produced, so cost them newest-lot-first.
    let need = fbaTotal;
    let val = 0;
    for (const l of finishedLots.get(p.id) ?? []) {
      if (need <= 0) break;
      const take = Math.min(need, l.units);
      val += take * l.cog;
      need -= take;
    }
    if (need > 0) val += need * (finishedLots.get(p.id)?.[0]?.cog ?? 0); // fallback for uncovered units
    amazonValue += val;

    const status: RestockRow["status"] = cover < minMonths ? "reorder" : cover < minMonths * 1.3 ? "watch" : "ok";
    const targetMonths = p.reorderToMonths ?? 12;
    const raw = status === "reorder" ? Math.max(0, Math.ceil(targetMonths * monthly - position)) : 0;
    const batch = p.batchSize ?? 0;
    const recommendedQty = batch > 0 && raw > 0 ? Math.ceil(raw / batch) * batch : raw;

    return {
      id: p.id,
      code: p.code,
      name: p.name,
      imageUrl: p.imageUrl,
      fbaAvailable: s?.fbaAvailable ?? 0,
      fbaInbound: s?.fbaInbound ?? 0,
      fbaReserved: s?.fbaReserved ?? 0,
      fbaTotal,
      inProduction,
      position,
      monthly,
      cover,
      minMonths,
      status,
      recommendedQty,
      amazonValue: val,
    };
  });
  rows.sort((a, b) => a.cover - b.cover); // most urgent first

  return {
    rows,
    lastSync,
    totals: {
      raw: rawInv.totalValue,
      inProduction: inProductionValue,
      amazon: amazonValue,
      total: rawInv.totalValue + inProductionValue + amazonValue,
      fbaUnits: rows.reduce((s, r) => s + r.fbaTotal, 0),
      inProductionUnits: rows.reduce((s, r) => s + r.inProduction, 0),
      reorderCount: rows.filter((r) => r.status === "reorder").length,
      avgCover: rows.length ? rows.reduce((s, r) => s + Math.min(r.cover, 60), 0) / rows.length : 0,
    },
  };
}
