/**
 * Loads all data from the DB, runs the FIFO engine, and writes the per-line cost
 * snapshot back onto each LotLine. Call this after any purchase/lot/transaction change.
 */
import { prisma } from "./prisma";
import { isLayerKind } from "./constants";
import {
  runEngine,
  type EnginePurchase,
  type EngineLotLine,
  type EngineTransaction,
  type EngineRawMovement,
  type PoolKey,
} from "./fifo";

/** Loads data + runs the engine WITHOUT persisting. Used by read-only queries.
 *  `excludeMovementId` runs the world WITHOUT one movement — a what-if for delete warnings. */
export async function computeEngineResult(opts: { excludeMovementId?: string } = {}) {
  const [purchasesRaw, lotsRaw, txRaw, rawMovesAll] = await Promise.all([
    prisma.purchase.findMany({
      include: { materialType: true, facility: true, product: true, invoice: { select: { createdAt: true } } },
      // FIFO consumes layers in this order, so it must be total and reproducible. Without an
      // explicit ORDER BY, two same-date purchases of one material could come back either way
      // round and produce a different COG on each recompute with no data change.
      orderBy: [{ date: "asc" }, { seq: "asc" }, { id: "asc" }],
    }),
    prisma.lot.findMany({
      include: {
        facility: true,
        lines: { include: { product: true, materials: { include: { materialType: true, product: true } } } },
      },
    }),
    prisma.transaction.findMany(),
    prisma.stockMovement.findMany({
      where: { itemType: "RAW" },
      include: { materialType: true, fromFacility: true, toFacility: true, product: true },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const rawMovesRaw = opts.excludeMovementId ? rawMovesAll.filter((m) => m.id !== opts.excludeMovementId) : rawMovesAll;

  const purchases: EnginePurchase[] = purchasesRaw.map((p, i) => ({
    materialCode: p.materialType.code,
    facility: p.facility.code,
    sku: p.materialType.skuSpecific ? (p.product?.code ?? null) : null,
    date: p.date.getTime(),
    // `seq` is now an index within its invoice, so it no longer orders invoices against each
    // other. `order` carries the total, stable ordering established by the query above.
    seq: p.seq,
    order: i,
    quantity: p.quantity,
    unitCost: p.unitCost,
    isAdjustment: p.isAdjustment,
  }));

  // Layer movements (starting balances, found-stock corrections) are FIFO layers, not movements:
  // stock appearing at an operator-entered cost. They enter the engine as purchase-shaped supply
  // at the receiving facility — dated at the movement date, so production consumes them in
  // chronological order exactly like bought stock, and they never touch later real costs.
  for (const [i, m] of rawMovesRaw.filter((m) => isLayerKind(m.kind)).entries()) {
    if (!m.toFacility || !m.materialType || !(m.quantity > 0)) continue;
    purchases.push({
      materialCode: m.materialType.code,
      facility: m.toFacility.code,
      sku: m.materialType.skuSpecific ? (m.product?.code ?? null) : null,
      date: m.date.getTime(),
      seq: 0,
      order: purchasesRaw.length + i,
      quantity: m.quantity,
      unitCost: m.unitCost ?? 0,
      isAdjustment: false,
    });
  }

  const lines: EngineLotLine[] = [];
  for (const lot of lotsRaw) {
    for (const ln of lot.lines) {
      lines.push({
        key: ln.id,
        lotId: lot.id,
        lotNr: lot.lotNr,
        // An undated lot must not sort to 1970 and consume the oldest, cheapest layers ahead of
        // every dated lot. Fall back to when the lot was created, which is always set.
        poDate: (lot.poDate ?? lot.createdAt).getTime(),
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

  // Transactions attach to a lot by id, not by lot number. `lotNr` has no unique constraint and
  // is handed out by a read-then-write, so two lots can share one — which would spread a single
  // invoice across both, giving each lot cost it never incurred.
  const transactions: EngineTransaction[] = txRaw.map((t) => ({
    lotId: t.lotId ?? null,
    category: t.category, // free-form; the engine buckets by whatever string this is
    applicable: t.applicableAmount,
    sku: t.skus,
    appliesToCog: t.appliesToCog,
  }));

  const rawMovements: EngineRawMovement[] = rawMovesRaw
    .filter((m) => !isLayerKind(m.kind) && m.fromFacility)
    .map((m, i) => ({
      materialCode: m.materialType?.code ?? "",
      fromFacility: m.fromFacility!.code,
      toFacility: m.toFacility?.code ?? null, // null = a loss (LOSS destination)
      sku: m.product?.code ?? null, // set for sku-specific materials
      quantity: m.quantity,
      date: m.date.getTime(),
      seq: i,
    }));

  const result = runEngine(purchases, lines, transactions, rawMovements);
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
        // The JSON maps are the whole truth: every material and every cost category, whatever
        // this business happens to call them. (The old fixed tea/pouch columns are gone — they
        // had no readers and were permanently zero for anyone not selling tea.)
        await tx.lotLine.update({
          where: { id: line.key },
          data: {
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
