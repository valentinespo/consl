/**
 * Loads all data from the DB, runs the FIFO engine, and writes the per-line cost
 * snapshot back onto each LotLine. Call this after any purchase/lot/transaction change.
 */
import { prisma } from "./prisma";
import {
  runEngine,
  type EnginePurchase,
  type EngineLotLine,
  type EngineTransaction,
  type PoolKey,
} from "./fifo";

/** Loads data + runs the engine WITHOUT persisting. Used by read-only queries. */
export async function computeEngineResult() {
  const [purchasesRaw, lotsRaw, txRaw] = await Promise.all([
    prisma.purchase.findMany({
      include: { materialType: true, facility: true, product: true },
    }),
    prisma.lot.findMany({
      include: {
        facility: true,
        lines: { include: { product: true, materials: { include: { materialType: true, product: true } } } },
      },
    }),
    prisma.transaction.findMany(),
  ]);

  const purchases: EnginePurchase[] = purchasesRaw.map((p) => ({
    materialCode: p.materialType.code,
    facility: p.facility.code,
    sku: p.materialType.skuSpecific ? (p.product?.code ?? null) : null,
    date: p.date.getTime(),
    seq: p.seq,
    quantity: p.quantity,
    unitCost: p.unitCost,
    isAdjustment: p.isAdjustment,
  }));

  const lines: EngineLotLine[] = [];
  for (const lot of lotsRaw) {
    for (const ln of lot.lines) {
      lines.push({
        key: ln.id,
        lotNr: lot.lotNr,
        poDate: lot.poDate ? lot.poDate.getTime() : 0,
        seq: ln.seq,
        facility: lot.facility.code,
        sku: ln.product.code,
        units: ln.units,
        materials: ln.materials.map((m) => ({
          materialCode: m.materialType.code,
          poolKey: m.materialType.poolKey as PoolKey,
          perUnit: m.perUnit,
          poolSku: m.product?.code ?? ln.product.code,
        })),
      });
    }
  }

  // lotNr -> id lookup for transactions
  const lotNrToId = new Map(lotsRaw.map((l) => [l.lotNr, l.id]));
  const transactions: EngineTransaction[] = txRaw.map((t) => {
    const lot = lotsRaw.find((l) => l.id === t.lotId);
    return {
      lotNr: lot?.lotNr ?? -1,
      category: t.category, // free-form; the engine buckets by whatever string this is
      applicable: t.applicableAmount,
      sku: t.skus,
      appliesToCog: t.appliesToCog,
    };
  });

  const result = runEngine(purchases, lines, transactions);
  return { result, lines, lotsRaw, purchasesRaw };
}

/** Runs the engine and persists each lot line's cost snapshot. Call after any data change. */
export async function recomputeAll() {
  const { result, lines } = await computeEngineResult();

  // Interactive transaction with a generous timeout: the per-query round-trip is fast on
  // Railway's internal network, but seeding from a laptop goes over the slower public proxy.
  await prisma.$transaction(
    async (tx) => {
      for (const line of lines) {
        const lc = result.lines.get(line.key)!;
        const mat = lc.materialCostsPerUnit;
        const txn = lc.transactionCostsPerUnit;
        // Legacy columns kept in sync for any un-migrated reader: "tea" = the primary COG
        // category, "other" = the remaining categories. Display now uses the JSON maps.
        const txnSum = Object.values(txn).reduce((s, v) => s + v, 0);
        const primary = txn["Ingredients"] ?? txn["TEA"] ?? 0;
        await tx.lotLine.update({
          where: { id: line.key },
          data: {
            teaCostPerUnit: primary,
            otherCostPerUnit: txnSum - primary,
            teabagCostPerUnit: mat["TEABAG"] ?? 0,
            pouchCostPerUnit: mat["POUCH"] ?? 0,
            cogPerUnit: lc.cogPerUnit,
            materialCostsJson: JSON.stringify(mat),
            transactionCostsJson: JSON.stringify(txn),
            shortfallsJson: JSON.stringify(lc.shortfalls),
          },
        });
      }
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  return result;
}
