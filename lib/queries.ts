import "server-only";
import { prisma } from "./prisma";
import { isLayerKind } from "./constants";
import { computeEngineResult } from "./recompute";
import { buildCostChips } from "./lot-costs";
import { runFinishedGoodsEngine, type FinishedSupply, type FinishedMovement, type ShippedLayer } from "./finished-goods";
import { deriveProduction, derivePayment, deriveFinishedAt, appearedAt } from "./lot-status";

export type InventoryPool = {
  materialCode: string;
  materialName: string;
  facility: string;
  sku: string | null;
  productName: string | null;
  imageUrl: string | null;
  quantityRemaining: number;
  valueRemaining: number;
};

export async function getInventory() {
  const { result } = await computeEngineResult();
  const [products, materials] = await Promise.all([
    prisma.product.findMany(),
    prisma.materialType.findMany(),
  ]);
  const prodName = new Map(products.map((p) => [p.code, p.name]));
  const prodImage = new Map(products.map((p) => [p.code, p.imageUrl]));
  const matName = new Map(materials.map((m) => [m.code, m.name]));
  const matImage = new Map(materials.map((m) => [m.code, m.imageUrl]));

  const pools: InventoryPool[] = result.pools
    .map((p) => ({
      materialCode: p.materialCode,
      materialName: matName.get(p.materialCode) ?? p.materialCode,
      facility: p.facility,
      sku: p.sku,
      productName: p.sku ? prodName.get(p.sku) ?? p.sku : null,
      imageUrl: p.sku ? prodImage.get(p.sku) ?? null : matImage.get(p.materialCode) ?? null,
      quantityRemaining: p.quantityRemaining,
      valueRemaining: p.valueRemaining,
    }))
    .sort((a, b) => b.valueRemaining - a.valueRemaining);

  const totalValue = pools.reduce((s, p) => s + p.valueRemaining, 0);

  return { pools, totalValue };
}

export async function getDashboard() {
  const inv = await getInventory();
  const [lots, purchaseRows, cogTxns] = await Promise.all([
    prisma.lot.findMany({ include: { lines: true, facility: true } }),
    prisma.purchase.findMany({
      where: { isAdjustment: false },
      select: { total: true, facility: { select: { code: true } }, supplier: { select: { name: true } } },
    }),
    // COG-contributing transaction lines only — the "Not applicable" (excluded) lines are dropped.
    prisma.transaction.findMany({ where: { appliesToCog: true }, select: { applicableAmount: true, supplier: { select: { name: true } } } }),
  ]);

  let inProductionValue = 0;
  let finishedValue = 0;
  const byFacility = new Map<string, number>();
  let totalUnits = 0;

  for (const lot of lots) {
    for (const ln of lot.lines) {
      const v = ln.cogPerUnit * ln.units;
      totalUnits += ln.units;
      // Status is per LINE — a finished SKU counts as finished even while its lot-mates cook.
      if (ln.status === "IN_PRODUCTION") inProductionValue += v;
      else finishedValue += v;
      byFacility.set(lot.facility.code, (byFacility.get(lot.facility.code) ?? 0) + v);
    }
  }

  // Purchase spend by facility (real purchases only, adjustments excluded).
  const purchByFacility = new Map<string, number>();
  let purchasesTotal = 0;
  for (const p of purchaseRows) {
    purchByFacility.set(p.facility.code, (purchByFacility.get(p.facility.code) ?? 0) + p.total);
    purchasesTotal += p.total;
  }

  // Amount spent, per supplier: real purchases + COG-contributing transaction lines. A row with no
  // supplier lands under "Unassigned" so the wheel's total always reconciles with the grand total.
  const spendBySupplier = new Map<string, number>();
  let spentTotal = 0;
  const addSpend = (name: string | null | undefined, v: number) => {
    const key = name?.trim() || "Unassigned";
    spendBySupplier.set(key, (spendBySupplier.get(key) ?? 0) + v);
    spentTotal += v;
  };
  for (const p of purchaseRows) addSpend(p.supplier?.name, p.total);
  for (const t of cogTxns) addSpend(t.supplier?.name, t.applicableAmount);

  const counts = {
    lots: lots.length,
    // "Open" = any SKU in the lot still cooking.
    inProduction: lots.filter((l) => l.lines.some((ln) => ln.status === "IN_PRODUCTION")).length,
    purchases: await prisma.purchase.count(),
    transactions: await prisma.transaction.count(),
    suppliers: await prisma.supplier.count(),
    products: await prisma.product.count(),
  };

  return {
    rawInventoryValue: inv.totalValue,
    inProductionValue,
    finishedValue,
    productionCOGValue: inProductionValue + finishedValue,
    totalUnits,
    byFacility: [...byFacility.entries()].map(([code, value]) => ({ code, value })).sort((a, b) => b.value - a.value),
    purchasesByFacility: [...purchByFacility.entries()].map(([code, value]) => ({ code, value })).sort((a, b) => b.value - a.value),
    purchasesTotal,
    spentBySupplier: [...spendBySupplier.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    spentTotal,
    counts,
  };
}

export async function getLots() {
  const [lots, materials] = await Promise.all([
    prisma.lot.findMany({
      include: {
        facility: true,
        lines: { include: { product: true } },
        // The count shown is INVOICES touching the lot, not allocation lines — one invoice split
        // across three lines is still one transaction to the person reading the table.
        transactions: { select: { invoiceId: true } },
        documents: { select: { id: true, label: true, fileUrl: true, fileName: true }, orderBy: [{ seq: "asc" }, { createdAt: "asc" }] },
      },
      orderBy: { lotNr: "desc" },
    }),
    prisma.materialType.findMany({ select: { code: true, name: true } }),
  ]);
  const matName = (code: string) => materials.find((m) => m.code === code)?.name ?? code;
  return lots.map((lot) => {
    const invoiceIds = new Set<string>();
    let looseLines = 0; // legacy lines with no parent invoice count as one transaction each
    for (const t of lot.transactions) (t.invoiceId ? invoiceIds.add(t.invoiceId) : looseLines++);
    const units = lot.lines.reduce((s, l) => s + l.units, 0);
    const cog = lot.lines.reduce((s, l) => s + l.cogPerUnit * l.units, 0);
    return {
      id: lot.id,
      lotNr: lot.lotNr,
      poNumber: lot.poNumber,
      poDate: lot.poDate,
      facility: lot.facility.code,
      facilityName: lot.facility.name,
      // Lot-level status/payment are DERIVED from the lines (lib/lot-status.ts).
      status: deriveProduction(lot.lines),
      paymentStatus: derivePayment(lot.lines),
      documents: lot.documents.map((d) => ({ id: d.id, label: d.label, fileUrl: d.fileUrl, fileName: d.fileName })),
      finishedAt: deriveFinishedAt(lot.lines),
      skus: lot.lines.map((l) => ({ code: l.product.code, imageUrl: l.product.imageUrl })),
      lines: lot.lines.map((l) => ({
        sku: l.product.code,
        productName: l.product.name,
        imageUrl: l.product.imageUrl,
        units: l.units,
        cogPerUnit: l.cogPerUnit,
        status: l.status,
        paymentStatus: l.paymentStatus,
        finishedAt: l.finishedAt,
        costs: buildCostChips(l.materialCostsJson, l.transactionCostsJson, l.shortfallsJson, matName),
      })),
      units,
      cogTotal: cog,
      avgCogPerUnit: units ? cog / units : 0,
      txnCount: invoiceIds.size + looseLines,
      notes: lot.notes,
    };
  });
}

export async function getLot(id: string) {
  return prisma.lot.findUnique({
    where: { id },
    include: {
      facility: true,
      lines: { include: { product: true, materials: { include: { materialType: true } } }, orderBy: { seq: "asc" } },
      transactions: { include: { supplier: true }, orderBy: [{ date: "asc" }] },
      documents: { orderBy: [{ seq: "asc" }, { createdAt: "asc" }] },
    },
  });
}

export async function getProducts() {
  return prisma.product.findMany({ orderBy: { code: "asc" } });
}

/** Map of SKU code → image URL, for avatars in forms/tables. */
export async function getProductImageMap(): Promise<Record<string, string | null>> {
  const products = await prisma.product.findMany();
  return Object.fromEntries(products.map((p) => [p.code, p.imageUrl]));
}

export async function getAllTransactions() {
  const txns = await prisma.transaction.findMany({
    include: { supplier: true, lot: true },
    orderBy: [{ date: "desc" }],
  });
  return txns.map((t) => ({
    id: t.id,
    dateISO: t.date ? t.date.toISOString().slice(0, 10) : null,
    lotId: t.lotId,
    lotNr: t.lot?.lotNr ?? null,
    supplier: t.supplier?.name ?? null,
    supplierPhotoUrl: t.supplier?.photoUrl ?? null,
    concept: t.concept,
    category: t.category as string,
    applicable: t.applicableAmount,
    appliesToCog: t.appliesToCog,
    skus: t.skus,
  }));
}

/** Transactions grouped into invoices (one real payment → many allocation lines). */
export async function getTransactionInvoices(lotId?: string) {
  const [invoices, products, lots] = await Promise.all([
    prisma.transactionInvoice.findMany({
      include: {
        supplier: true,
        lines: { include: { lot: true }, orderBy: { createdAt: "asc" } },
        documents: { orderBy: [{ seq: "asc" }, { createdAt: "asc" }] },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    prisma.product.findMany(),
    prisma.lot.findMany({ include: { lines: { include: { product: true } } } }),
  ]);
  const prodImage = new Map(products.map((p) => [p.code, p.imageUrl]));
  // Which SKUs each lot currently produces — used to detect a tag pointing at a removed SKU.
  const lotSkus = new Map(lots.map((l) => [l.id, new Set(l.lines.map((x) => x.product.code))]));
  const mapped = invoices.map((inv) => {
    const lines = inv.lines.map((l) => ({
      id: l.id,
      lotId: l.lotId,
      lotNr: l.lot?.lotNr ?? null,
      category: l.category,
      amount: l.applicableAmount,
      sku: l.skus,
      concept: l.concept,
      appliesToCog: l.appliesToCog,
      // SKU tag points to a SKU no longer in its (still-existing) lot → unassigned, out of COG.
      skuMissing: !!(l.appliesToCog && l.lotId && l.skus && !lotSkus.get(l.lotId)?.has(l.skus)),
    }));
    const applicable = lines.filter((l) => l.appliesToCog).reduce((s, l) => s + l.amount, 0);
    const notApplicable = lines.filter((l) => !l.appliesToCog).reduce((s, l) => s + l.amount, 0);
    const unassignedAmount = lines
      .filter((l) => l.appliesToCog && (!l.lotId || l.skuMissing))
      .reduce((s, l) => s + l.amount, 0);
    const skuMissingSet = new Set(lines.filter((l) => l.skuMissing).map((l) => l.sku));
    const presentSkus = [...new Set(lines.map((l) => l.sku).filter((s): s is string => !!s))].map((code) => ({
      code,
      imageUrl: prodImage.get(code) ?? null,
      missing: skuMissingSet.has(code),
    }));
    const presentLots = [
      ...new Map(lines.filter((l) => l.lotNr != null).map((l) => [l.lotNr, { lotId: l.lotId, lotNr: l.lotNr! }])).values(),
    ].sort((a, b) => a.lotNr - b.lotNr);
    const presentCats = [...new Set(lines.map((l) => l.category))];
    return {
      id: inv.id,
      dateISO: inv.date ? inv.date.toISOString().slice(0, 10) : null,
      supplier: inv.supplier?.name ?? null,
      supplierPhotoUrl: inv.supplier?.photoUrl ?? null,
      invoiceTotal: inv.invoiceTotal,
      documents: inv.documents.map((d) => ({ id: d.id, label: d.label, fileUrl: d.fileUrl, fileName: d.fileName })),
      applicable,
      notApplicable,
      unassignedAmount,
      presentSkus,
      presentLots,
      presentCats,
      hasUnassigned: lines.some((l) => l.appliesToCog && !l.lotId),
      hasSkuUnassigned: lines.some((l) => l.skuMissing),
      lines,
    };
  });
  return lotId ? mapped.filter((inv) => inv.lines.some((l) => l.lotId === lotId)) : mapped;
}

/** Run the finished-goods engine: where finished units physically are and what they're worth.
 *  Supply is per LINE: a finished SKU feeds the pools even while its lot-mates are still cooking. */
export async function computeFinishedGoods() {
  const [lots, movements, products] = await Promise.all([
    prisma.lot.findMany({
      where: { lines: { some: { status: "FINISHED" } } },
      include: { lines: true },
      orderBy: [{ poDate: "desc" }, { createdAt: "desc" }],
    }),
    prisma.stockMovement.findMany({ where: { itemType: "FINISHED" }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
    prisma.product.findMany({ select: { id: true, openingUnitCost: true } }),
  ]);
  const supply: FinishedSupply[] = [];
  // Finished lines dated by when their units APPEARED (the line's finish date, see
  // lib/lot-status appearedAt), oldest first — so the pools consume in true chronological order
  // and same-day layers break their tie by age rather than by query order.
  const finished = lots
    .flatMap((lot) => lot.lines.filter((ln) => ln.status === "FINISHED").map((ln) => ({ lot, ln, at: appearedAt(ln, lot).getTime() })))
    .sort((a, b) => a.at - b.at || a.lot.lotNr - b.lot.lotNr || a.ln.seq - b.ln.seq);
  finished.forEach((f, i) =>
    supply.push({
      sku: f.ln.productId,
      facilityId: f.lot.facilityId,
      units: f.ln.units,
      unitCost: f.ln.cogPerUnit,
      date: f.at,
      seq: i,
    }),
  );
  // Newest-FINISHED cost per product, falling back to the onboarding COG — what a channel
  // pull-back beyond recorded layers is costed at, mirroring lib/restock.ts.
  const fallbackCostBySku = new Map<string, number>(products.map((p) => [p.id, p.openingUnitCost ?? 0]));
  for (let i = finished.length - 1; i >= 0; i--) fallbackCostBySku.set(finished[i].ln.productId, finished[i].ln.cogPerUnit);
  let seq = finished.length;
  // Opening balances are day-zero layers: at your own facilities they're supply; at a channel
  // they seed that channel's ledger so a pull-back can consume them (see lib/restock.ts).
  const channelSeed: ShippedLayer[] = [];
  for (const m of movements) {
    if (!isLayerKind(m.kind) || !m.productId || !(m.quantity > 0)) continue;
    if (m.toFacilityId) {
      supply.push({
        sku: m.productId,
        facilityId: m.toFacilityId,
        units: m.quantity,
        unitCost: m.unitCost ?? 0,
        date: m.date.getTime(),
        seq: seq++,
      });
    } else if (m.toDestination) {
      channelSeed.push({ sku: m.productId, destination: m.toDestination, units: m.quantity, unitCost: m.unitCost ?? 0, date: m.date.getTime() });
    }
  }
  const mv: FinishedMovement[] = movements
    .filter((m) => !isLayerKind(m.kind) && (m.fromFacilityId || m.fromDestination))
    .map((m, i) => ({
      id: m.id,
      sku: m.productId ?? "",
      fromFacilityId: m.fromFacilityId,
      fromDestination: m.fromDestination,
      toFacilityId: m.toFacilityId,
      toDestination: m.toDestination,
      quantity: m.quantity,
      date: m.date.getTime(),
      seq: i,
    }));
  return runFinishedGoodsEngine(supply, mv, channelSeed, fallbackCostBySku);
}

/** Finished stock on hand at your own facilities, with product + facility names attached. */
export async function getFinishedStock() {
  const [{ pools, shortfalls }, products, facilities] = await Promise.all([
    computeFinishedGoods(),
    prisma.product.findMany({ select: { id: true, code: true, name: true, imageUrl: true } }),
    prisma.facility.findMany({ select: { id: true, code: true, name: true } }),
  ]);
  const p = new Map(products.map((x) => [x.id, x]));
  const f = new Map(facilities.map((x) => [x.id, x]));
  return {
    rows: pools
      .map((pool) => ({
        productId: pool.sku,
        code: p.get(pool.sku)?.code ?? "?",
        name: p.get(pool.sku)?.name ?? "",
        imageUrl: p.get(pool.sku)?.imageUrl ?? null,
        facilityId: pool.facilityId,
        facilityCode: f.get(pool.facilityId)?.code ?? "?",
        facilityName: f.get(pool.facilityId)?.name ?? "",
        units: pool.units,
        value: pool.value,
      }))
      .sort((a, b) => b.value - a.value),
    shortfalls,
  };
}

/** Suppliers as light options for the facility ↔ supplier link picker. */
export async function getSupplierOptions() {
  const s = await prisma.supplier.findMany({
    select: { id: true, name: true, facilityId: true, address: true },
    orderBy: { name: "asc" },
  });
  return s.map((x) => ({ id: x.id, name: x.name, facilityId: x.facilityId, address: x.address }));
}

/** The movement ledger (raw + finished), newest first. */
export async function getMovements() {
  const movements = await prisma.stockMovement.findMany({
    include: { product: true, materialType: true, fromFacility: true, toFacility: true },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return movements.map((m) => {
    const raw = m.itemType === "RAW";
    return {
      id: m.id,
      date: m.date,
      itemType: m.itemType,
      kind: m.kind, // OPENING rows render as "Starting balance" (no source facility)
      // Raw: the material (with the SKU pool it belongs to, if any). Finished: the product.
      code: raw ? m.materialType?.code ?? "?" : m.product?.code ?? "?",
      itemName: raw ? m.materialType?.name ?? "" : m.product?.name ?? "",
      poolSku: raw ? m.product?.code ?? null : null,
      imageUrl: raw ? m.materialType?.imageUrl ?? null : m.product?.imageUrl ?? null,
      quantity: m.quantity,
      fromCode: m.fromFacility?.code ?? null,
      fromDestination: m.fromDestination,
      toCode: m.toFacility?.code ?? null,
      toDestination: m.toDestination,
      unitCost: m.unitCost, // set on layer rows (starting balance / found stock / return)
      notes: m.notes,
    };
  });
}

/** Raw materials on hand grouped by facility, for the facility cards / detail pages. */
export async function getRawStockByFacility() {
  const { pools } = await getInventory();
  const byFacility = new Map<string, { code: string; name: string; imageUrl: string | null; sku: string | null; units: number; value: number }[]>();
  for (const p of pools) {
    if (p.quantityRemaining <= 0.5) continue;
    const list = byFacility.get(p.facility) ?? [];
    list.push({ code: p.materialCode, name: p.materialName, imageUrl: p.imageUrl, sku: p.sku, units: p.quantityRemaining, value: p.valueRemaining });
    byFacility.set(p.facility, list);
  }
  for (const l of byFacility.values()) l.sort((a, b) => b.value - a.value);
  return byFacility; // keyed by facility CODE
}

/** Every cost category currently used by a transaction, so the dropdown can offer them again.
 *  A category with no remaining transactions simply stops appearing (derived, like suppliers). */
export async function getCategoriesInUse(): Promise<string[]> {
  const rows = await prisma.transaction.findMany({ distinct: ["category"], select: { category: true } });
  return rows.map((r) => r.category).filter(Boolean);
}

/** Lot options for transaction assignment dropdowns. */
export async function getLotOptions() {
  const lots = await prisma.lot.findMany({
    include: { facility: true, lines: { include: { product: true } } },
    orderBy: { lotNr: "desc" },
  });
  return lots.map((l) => ({
    id: l.id,
    lotNr: l.lotNr,
    label: `Lot #${l.lotNr} · ${l.facility.code} · ${l.lines.map((x) => x.product.code).join(", ")}`,
    skus: l.lines.map((x) => x.product.code),
  }));
}

export async function getFacilities() {
  // Pickers only — channel facilities (Amazon FBA/AWD…) are never vendors, lot sites or
  // movement targets, so they stay out of every dropdown this feeds.
  const f = await prisma.facility.findMany({ where: { channel: null }, orderBy: { code: "asc" } });
  return f.map((x) => ({ id: x.id, code: x.code, name: x.name }));
}

export async function getSupplierNames() {
  const s = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
  return s.map((x) => x.name);
}

export async function getMaterialTypes() {
  const m = await prisma.materialType.findMany({ orderBy: { name: "asc" } });
  return m.map((x) => ({
    id: x.id,
    code: x.code,
    name: x.name,
    unitLabel: x.unitLabel,
    lowStockThreshold: x.lowStockThreshold,
    skuSpecific: x.skuSpecific,
    imageUrl: x.imageUrl,
  }));
}

/** Which first-run setup steps a company has completed. Drives the Getting Started checklist,
 *  so a brand-new account always knows what to do next. */
export async function getSetupProgress() {
  const [products, materials, facilities, suppliers, purchases, lots, mapped, dismissed] = await Promise.all([
    prisma.product.count(),
    prisma.materialType.count(),
    prisma.facility.count(),
    prisma.supplier.count(),
    prisma.purchase.count(),
    prisma.lot.count(),
    prisma.product.count({
      where: {
        OR: [
          { asin: { not: null } },
          { barcode: { not: null } },
          { shopifyProductId: { not: null } },
          { tiktokProductId: { not: null } },
        ],
      },
    }),
    prisma.dismissedNotification.findFirst({ where: { key: SETUP_DISMISS_KEY } }),
  ]);
  return { products, materials, facilities, suppliers, purchases, lots, mapped, dismissed: !!dismissed };
}

export const SETUP_DISMISS_KEY = "getting-started";

/** A record's dependants, as `{ label → count }`. Non-zero entries block deletion. */
export type UsedBy = Record<string, number>;

/** Drop zero counts so callers can just check `Object.keys(usedBy).length`. */
function used(entries: Record<string, number>): UsedBy {
  return Object.fromEntries(Object.entries(entries).filter(([, n]) => n > 0));
}

/** One product + everything referencing it (drives the detail page's danger zone). */
export async function getProductDetail(id: string) {
  const product = await prisma.product.findFirst({ where: { id } });
  if (!product) return null;
  // Amazon snapshots are derived sync data and cascade away with the product, so they never block.
  const [lotLines, purchases, poLines, transactions] = await Promise.all([
    prisma.lotLine.count({ where: { productId: id } }),
    prisma.purchase.count({ where: { productId: id } }),
    prisma.purchaseOrderLine.count({ where: { productId: id } }),
    prisma.transaction.count({ where: { skus: product.code } }),
  ]);
  return {
    product,
    usedBy: used({ "production lots": lotLines, purchases, "purchase-order lines": poLines, transactions }),
  };
}

/** One raw material + everything referencing it. */
export async function getMaterialDetail(id: string) {
  const material = await prisma.materialType.findFirst({ where: { id } });
  if (!material) return null;
  // Movements count as usage on both the delete guard and the per-SKU-stocking lock, so the UI
  // agrees with what updateMaterial/deleteMaterial will actually allow.
  const [purchases, invoices, lotMaterials, movements] = await Promise.all([
    prisma.purchase.count({ where: { materialTypeId: id } }),
    prisma.purchaseInvoice.count({ where: { materialTypeId: id } }),
    prisma.lotMaterial.count({ where: { materialTypeId: id } }),
    prisma.stockMovement.count({ where: { materialTypeId: id } }),
  ]);
  return {
    material,
    usedBy: used({
      purchases,
      "purchase invoices": invoices,
      "lot recipes": lotMaterials,
      "stock movements": movements,
    }),
  };
}

/** One facility + everything referencing it, including the supplier profile it's linked to. */
export async function getFacilityDetail(id: string) {
  const facility = await prisma.facility.findFirst({ where: { id }, include: { supplierProfile: true } });
  if (!facility) return null;
  // Movements on either side count: a 3PL you only ship *to* has no lots, purchases or POs, and
  // deleting it would silently drop everything held there out of the ledger.
  const [lots, purchases, purchaseOrders, movesFrom, movesTo] = await Promise.all([
    prisma.lot.count({ where: { facilityId: id } }),
    prisma.purchase.count({ where: { facilityId: id } }),
    prisma.purchaseOrder.count({ where: { facilityId: id } }),
    prisma.stockMovement.count({ where: { fromFacilityId: id } }),
    prisma.stockMovement.count({ where: { toFacilityId: id } }),
  ]);
  return {
    facility,
    usedBy: used({
      "production lots": lots,
      purchases,
      "purchase orders": purchaseOrders,
      "stock movements": movesFrom + movesTo,
    }),
  };
}

/** Every facility with its dependant counts, for the Facilities list. */
export async function getFacilitiesDetailed() {
  return prisma.facility.findMany({
    include: { _count: { select: { lots: true, purchases: true, purchaseOrders: true } } },
    orderBy: { code: "asc" },
  });
}

/** One supplier + everything referencing it. */
export async function getSupplierDetail(id: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id }, include: { facility: true } });
  if (!supplier) return null;
  const [purchases, transactions, purchaseInvoices, transactionInvoices] = await Promise.all([
    prisma.purchase.count({ where: { supplierId: id } }),
    prisma.transaction.count({ where: { supplierId: id } }),
    prisma.purchaseInvoice.count({ where: { supplierId: id } }),
    prisma.transactionInvoice.count({ where: { supplierId: id } }),
  ]);
  return {
    supplier,
    usedBy: used({ purchases, transactions, "purchase invoices": purchaseInvoices, "transaction invoices": transactionInvoices }),
  };
}

export async function getPurchasesByMaterial() {
  const [materials, purchases] = await Promise.all([
    prisma.materialType.findMany({ orderBy: { name: "asc" } }),
    prisma.purchase.findMany({
      include: { supplier: true, facility: true, product: true, materialType: true },
      orderBy: [{ date: "desc" }],
    }),
  ]);
  return materials.map((m) => {
    const rows = purchases.filter((p) => p.materialTypeId === m.id);
    return {
      material: { id: m.id, code: m.code, name: m.name, unitLabel: m.unitLabel, skuSpecific: m.skuSpecific, imageUrl: m.imageUrl },
      totalQty: rows.reduce((s, p) => s + p.quantity, 0),
      totalSpend: rows.reduce((s, p) => s + p.total, 0),
      rows: rows.map((p) => ({
        id: p.id,
        materialTypeId: p.materialTypeId,
        dateISO: p.date.toISOString().slice(0, 10),
        supplier: p.supplier?.name ?? null,
        facility: p.facility.code,
        facilityId: p.facilityId,
        sku: p.product?.code ?? null,
        productId: p.productId,
        imageUrl: p.product?.imageUrl ?? null,
        quantity: p.quantity,
        unitCost: p.unitCost,
        total: p.total,
        notes: p.notes,
      })),
    };
  });
}

/** Purchases grouped: per material → invoices → lines. One material per invoice. */
export async function getPurchaseInvoicesByMaterial() {
  const [materials, invoices] = await Promise.all([
    prisma.materialType.findMany({ orderBy: { name: "asc" } }),
    prisma.purchaseInvoice.findMany({
      include: {
        supplier: true,
        lines: { include: { facility: true, product: true }, orderBy: { seq: "asc" } },
        documents: { orderBy: [{ seq: "asc" }, { createdAt: "asc" }] },
      },
      orderBy: [{ date: "desc" }],
    }),
  ]);
  return materials.map((m) => {
    const invs = invoices.filter((i) => i.materialTypeId === m.id);
    return {
      material: { id: m.id, code: m.code, name: m.name, unitLabel: m.unitLabel, skuSpecific: m.skuSpecific, imageUrl: m.imageUrl },
      totalQty: invs.reduce((s, i) => s + i.lines.reduce((a, l) => a + l.quantity, 0), 0),
      totalSpend: invs.reduce((s, i) => s + i.invoiceTotal, 0),
      invoices: invs.map((i) => ({
        id: i.id,
        dateISO: i.date.toISOString().slice(0, 10),
        supplier: i.supplier?.name ?? null,
        supplierPhotoUrl: i.supplier?.photoUrl ?? null,
        invoiceTotal: i.invoiceTotal,
        documents: i.documents.map((d) => ({ id: d.id, label: d.label, fileUrl: d.fileUrl, fileName: d.fileName })),
        totalQty: i.lines.reduce((a, l) => a + l.quantity, 0),
        facilities: [...new Set(i.lines.map((l) => l.facility.code))],
        skus: [
          ...new Map(
            i.lines.filter((l) => l.product).map((l) => [l.product!.code, { code: l.product!.code, imageUrl: l.product!.imageUrl }]),
          ).values(),
        ],
        lines: i.lines.map((l) => ({
          id: l.id,
          facilityId: l.facilityId,
          facility: l.facility.code,
          productId: l.productId,
          sku: l.product?.code ?? null,
          imageUrl: l.product?.imageUrl ?? null,
          quantity: l.quantity,
          unitCost: l.unitCost,
          total: l.total,
        })),
      })),
    };
  });
}

export async function getPurchaseFormOptions() {
  const [facilities, products, suppliers, materials] = await Promise.all([
    prisma.facility.findMany({ where: { channel: null }, orderBy: { code: "asc" } }),
    prisma.product.findMany({ orderBy: { code: "asc" } }),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
    prisma.materialType.findMany({ orderBy: { name: "asc" } }),
  ]);
  return {
    facilities: facilities.map((f) => ({ id: f.id, code: f.code, name: f.name })),
    products: products.map((p) => ({ id: p.id, code: p.code, name: p.name, imageUrl: p.imageUrl })),
    suppliers: suppliers.map((s) => s.name),
    materials: materials.map((m) => ({ id: m.id, code: m.code, name: m.name, skuSpecific: m.skuSpecific, unitLabel: m.unitLabel })),
  };
}

/** All purchase orders, newest first, for the archive tab. */
export async function getPurchaseOrders() {
  const pos = await prisma.purchaseOrder.findMany({
    include: {
      facility: true,
      lot: { select: { id: true, lotNr: true } },
      lines: { include: { product: true }, orderBy: { seq: "asc" } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return pos.map((po) => ({
    id: po.id,
    number: po.number,
    dateISO: po.date.toISOString().slice(0, 10),
    status: po.status,
    facilityId: po.facilityId,
    vendor: po.facility.legalName ?? po.facility.name,
    facilityCode: po.facility.code,
    lotId: po.lot?.id ?? null,
    lotNr: po.lot?.lotNr ?? null,
    total: po.total,
    pdfUrl: po.pdfUrl,
    imported: po.imported, // historical archive PO — read-only, its lot predates it
    lines: po.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      productId: l.productId,
      sku: l.product?.code ?? null,
      skuImageUrl: l.product?.imageUrl ?? null,
      description: l.description,
      unitCost: l.unitCost,
      quantity: l.quantity,
      lotUnits: l.lotUnits,
    })),
  }));
}

/** Options for the PO creation form. */
export async function getPoFormOptions() {
  const [facilities, products, lotNrs, pricedLines, feeLines] = await Promise.all([
    prisma.facility.findMany({ where: { channel: null }, include: { supplierProfile: true }, orderBy: { code: "asc" } }),
    prisma.product.findMany({ orderBy: { code: "asc" } }),
    prisma.lot.findMany({ select: { lotNr: true } }),
    prisma.purchaseOrderLine.findMany({
      where: { kind: "SKU", productId: { not: null } },
      include: { po: { select: { number: true, date: true, createdAt: true, facilityId: true } } },
      orderBy: [{ po: { date: "desc" } }, { po: { createdAt: "desc" } }, { seq: "asc" }],
    }),
    prisma.purchaseOrderLine.findMany({
      where: { kind: "FEE" },
      select: { description: true, po: { select: { date: true } } },
      orderBy: [{ po: { date: "desc" } }, { seq: "asc" }],
    }),
  ]);
  // Previously used fee descriptions, most recent first — suggestions for new fee lines.
  const feeDescs = [...new Set(feeLines.map((f) => f.description.trim()).filter(Boolean))];
  // Lowest free number — a deleted PO/lot's number gets reused.
  const used = new Set(lotNrs.map((l) => l.lotNr));
  let nextLotNr = 1;
  while (used.has(nextLotNr)) nextLotNr++;
  // Most recent PO price per product, and most recent printed description per vendor+product.
  const lastPrice = new Map<string, { cost: number; poNumber: string }>();
  const descSeeds: Record<string, string> = {};
  for (const l of pricedLines) {
    if (l.unitCost != null && !lastPrice.has(l.productId!)) lastPrice.set(l.productId!, { cost: l.unitCost, poNumber: l.po.number });
    const dk = `${l.po.facilityId}|${l.productId}`;
    if (l.description.trim() && !(dk in descSeeds)) descSeeds[dk] = l.description;
  }
  return {
    // Vendor block mirrors the PDF: a linked supplier owns the address, so it's entered once.
    facilities: facilities.map((f) => ({
      id: f.id,
      code: f.code,
      name: f.name,
      legalName: f.legalName ?? f.supplierProfile?.name ?? f.name,
      address: f.supplierProfile?.address ?? f.address ?? "",
    })),
    products: products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      imageUrl: p.imageUrl,
      lastCost: lastPrice.get(p.id)?.cost ?? null,
      lastPoNumber: lastPrice.get(p.id)?.poNumber ?? null,
    })),
    descSeeds, // "facilityId|productId" -> description as printed on the most recent PO
    feeDescs,
    nextLotNr,
  };
}

export async function getSuppliers() {
  const suppliers = await prisma.supplier.findMany({
    include: { facility: true, _count: { select: { purchases: true, transactions: true } } },
    orderBy: { name: "asc" },
  });
  const spendBySupplier = await prisma.transaction.groupBy({
    by: ["supplierId"],
    _sum: { applicableAmount: true },
  });
  const purchaseSpend = await prisma.purchase.groupBy({
    by: ["supplierId"],
    _sum: { total: true },
  });
  const txMap = new Map(spendBySupplier.map((s) => [s.supplierId, s._sum.applicableAmount ?? 0]));
  const pMap = new Map(purchaseSpend.map((s) => [s.supplierId, s._sum.total ?? 0]));
  return suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    photoUrl: s.photoUrl,
    email: s.email,
    phone: s.phone,
    address: s.address,
    notes: s.notes,
    facilityId: s.facilityId,
    facilityCode: s.facility?.code ?? null,
    purchases: s._count.purchases,
    transactions: s._count.transactions,
    totalSpend: (txMap.get(s.id) ?? 0) + (pMap.get(s.id) ?? 0),
  }));
}

export type LeadTimes = {
  blendedDays: number | null; // null until at least one lot qualifies
  lots: number; // how many finished lots the averages stand on
  perFacility: { code: string; avgDays: number; lots: number }[]; // slowest first
};

/**
 * Average production lead time, measured from real lots: PO date → finished date, per producing
 * facility and blended across all of them. Every finished lot carrying both dates counts, exactly
 * as recorded — no exclusions, no cleverness. The dates are hand-correctable on the lot, so the
 * cure for an odd-looking span is fixing the record, not code quietly dropping it.
 */
export async function getLeadTimes(): Promise<LeadTimes> {
  // One span PER LOT (per production run), so a big multi-SKU batch counts once, not once per SKU
  // — otherwise a slow 6-SKU lot would drag the average six times harder than a fast 1-SKU lot.
  // Each lot's span is the AVERAGE of its finished SKU lines' PO→finished days, so a lot whose SKUs
  // finish on different days gets a blended figure instead of relying on a single derived date.
  const lots = await prisma.lot.findMany({
    where: { poDate: { not: null }, lines: { some: { status: "FINISHED", finishedAt: { not: null } } } },
    select: {
      poDate: true,
      facility: { select: { code: true } },
      lines: { where: { status: "FINISHED", finishedAt: { not: null } }, select: { finishedAt: true } },
    },
  });
  const DAY = 86_400_000;
  const spans = lots.map((lot) => {
    const po = lot.poDate!.getTime();
    const skuDays = lot.lines.map((ln) => (ln.finishedAt!.getTime() - po) / DAY);
    return { code: lot.facility.code, days: Math.round(skuDays.reduce((s, d) => s + d, 0) / skuDays.length) };
  });
  if (spans.length === 0) return { blendedDays: null, lots: 0, perFacility: [] };

  const avg = (a: { days: number }[]) => Math.round(a.reduce((s, x) => s + x.days, 0) / a.length);
  const byCode = new Map<string, { days: number }[]>();
  for (const s of spans) (byCode.get(s.code) ?? byCode.set(s.code, []).get(s.code)!).push(s);
  return {
    blendedDays: avg(spans),
    lots: spans.length,
    perFacility: [...byCode.entries()]
      .map(([code, g]) => ({ code, avgDays: avg(g), lots: g.length }))
      .sort((a, b) => b.avgDays - a.avgDays),
  };
}
