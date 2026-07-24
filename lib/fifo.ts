/**
 * Herbl FIFO costing engine — pure, deterministic, no DB/IO.
 *
 * Two cost sources per lot line:
 *  1. FIFO materials (stocked): each material a lot consumes. Cost = oldest-stock-first from purchases.
 *  2. Transaction costs (made-to-order): the "applicable" amounts of transactions assigned to the
 *     lot, bucketed by their category (Ingredients, Production, or any custom category).
 *
 * Pool keys come from each material's poolKey:
 *   FACILITY      -> one pool per facility (tea bags)
 *   FACILITY_SKU  -> one pool per facility+SKU (pouches)
 *
 * A lot line places demand = units * perUnit on each of its materials' pools, consumed
 * in lot order (by poDate, then lotNr). Adjustment purchases (lost inventory) are excluded
 * from supply, matching the source spreadsheet.
 */

export type PoolKey = "FACILITY" | "FACILITY_SKU";

export interface EnginePurchase {
  materialCode: string;
  facility: string;
  sku: string | null; // set for FACILITY_SKU materials
  date: number; // epoch ms (sort key)
  seq: number; // tie-breaker preserving sheet row order
  quantity: number;
  unitCost: number;
  isAdjustment: boolean;
}

export interface EngineLotMaterial {
  materialCode: string;
  poolKey: PoolKey;
  perUnit: number;
  poolSku: string | null; // which SKU's pool to draw for FACILITY_SKU
}

export interface EngineLotLine {
  key: string; // unique line id
  lotNr: number;
  poDate: number; // epoch ms
  seq: number; // tie-breaker
  facility: string;
  sku: string;
  units: number;
  materials: EngineLotMaterial[];
}

export interface EngineTransaction {
  lotNr: number;
  category: string; // free-form cost category
  applicable: number;
  sku: string | null;
  appliesToCog: boolean; // false = excluded from COG (fees, "Not applicable")
}

/** A raw-material stock movement out of a facility: a transfer to another facility, or a loss.
 *  Applied after production, so it only adjusts what's left on hand — the same slot lost-inventory
 *  adjustments used, keeping produced-lot costs untouched. */
export interface EngineRawMovement {
  materialCode: string;
  fromFacility: string;
  toFacility: string | null; // set for a transfer; null = it left inventory (a loss)
  sku: string | null; // for FACILITY_SKU materials (e.g. printed pouches)
  quantity: number; // positive
  date: number;
  seq: number;
}

export interface MaterialShortfall {
  materialCode: string;
  demand: number; // total units of material the lot needs
  consumed: number; // how much stock was actually available
  shortBy: number; // demand - consumed (units not yet purchased)
}

export interface LineCost {
  key: string;
  materialCostsPerUnit: Record<string, number>; // e.g. { TEABAG: .03, POUCH: .81 }
  transactionCostsPerUnit: Record<string, number>; // e.g. { Ingredients: 1.2, Production: 0.4 }
  shortfalls: MaterialShortfall[]; // materials with insufficient stock for this lot
  cogPerUnit: number;
}

export interface PoolRemaining {
  poolId: string;
  materialCode: string;
  facility: string;
  sku: string | null;
  quantityRemaining: number;
  valueRemaining: number;
}

export interface EngineResult {
  lines: Map<string, LineCost>;
  pools: PoolRemaining[];
}

/** A FIFO stack of purchase layers for one pool. Consume oldest-first. */
class FifoPool {
  private layers: { qty: number; unitCost: number }[];
  private idx = 0; // current layer
  private usedInLayer = 0; // qty consumed from current layer

  constructor(
    readonly poolId: string,
    readonly materialCode: string,
    readonly facility: string,
    readonly sku: string | null,
    purchases: EnginePurchase[],
  ) {
    this.layers = purchases
      .filter((p) => !p.isAdjustment && p.quantity > 0)
      .sort((a, b) => a.date - b.date || a.seq - b.seq)
      .map((p) => ({ qty: p.quantity, unitCost: p.unitCost }));
  }

  /** Append a layer of already-owned stock (a transfer arriving from another facility). Applied
   *  after production, so it only affects what's left on hand — never re-costs a produced lot. */
  addLayer(qty: number, unitCost: number) {
    if (qty > 1e-9) this.layers.push({ qty, unitCost });
  }

  /** Consume `demand` units; returns cost drawn and how much was actually available. */
  consume(demand: number): { cost: number; consumed: number } {
    let remaining = demand;
    let cost = 0;
    while (remaining > 1e-9 && this.idx < this.layers.length) {
      const layer = this.layers[this.idx];
      const avail = layer.qty - this.usedInLayer;
      const take = Math.min(avail, remaining);
      cost += take * layer.unitCost;
      this.usedInLayer += take;
      remaining -= take;
      if (this.usedInLayer >= layer.qty - 1e-9) {
        this.idx++;
        this.usedInLayer = 0;
      }
    }
    // Demand beyond available supply is not costed (no inventing cost) — the leftover is
    // reported as a shortfall instead (material not yet purchased).
    return { cost, consumed: demand - remaining };
  }

  remaining(): { qty: number; value: number } {
    let qty = 0;
    let value = 0;
    for (let i = this.idx; i < this.layers.length; i++) {
      const used = i === this.idx ? this.usedInLayer : 0;
      const left = this.layers[i].qty - used;
      qty += left;
      value += left * this.layers[i].unitCost;
    }
    return { qty, value };
  }
}

function poolId(materialCode: string, poolKey: PoolKey, facility: string, sku: string | null): string {
  return poolKey === "FACILITY_SKU"
    ? `${materialCode}|${facility}|${sku ?? ""}`
    : `${materialCode}|${facility}`;
}

export function runEngine(
  purchases: EnginePurchase[],
  lines: EngineLotLine[],
  transactions: EngineTransaction[],
  rawMovements: EngineRawMovement[] = [],
): EngineResult {
  // ---- Build FIFO pools, bucketing purchases by their pool id. ----
  // poolKey per material is inferred from how purchases carry sku: a material that ever
  // has an sku is FACILITY_SKU. We derive it from the line materials instead (authoritative).
  const materialPoolKey = new Map<string, PoolKey>();
  for (const l of lines) for (const m of l.materials) materialPoolKey.set(m.materialCode, m.poolKey);

  const poolBuckets = new Map<string, EnginePurchase[]>();
  for (const p of purchases) {
    const pk = materialPoolKey.get(p.materialCode) ?? (p.sku ? "FACILITY_SKU" : "FACILITY");
    const id = poolId(p.materialCode, pk, p.facility, p.sku);
    (poolBuckets.get(id) ?? poolBuckets.set(id, []).get(id)!).push(p);
  }
  const pools = new Map<string, FifoPool>();
  for (const [id, ps] of poolBuckets) {
    const sample = ps[0];
    pools.set(id, new FifoPool(id, sample.materialCode, sample.facility, sample.sku, ps));
  }

  // ---- Consume materials in lot order. ----
  const ordered = [...lines].sort((a, b) => a.poDate - b.poDate || a.lotNr - b.lotNr || a.seq - b.seq);
  const result = new Map<string, LineCost>();

  for (const line of ordered) {
    const materialCostsPerUnit: Record<string, number> = {};
    const shortfalls: MaterialShortfall[] = [];
    for (const m of line.materials) {
      const sku = m.poolKey === "FACILITY_SKU" ? (m.poolSku ?? line.sku) : null;
      const id = poolId(m.materialCode, m.poolKey, line.facility, sku);
      const pool = pools.get(id);
      const demand = line.units * m.perUnit;
      const { cost, consumed } = pool ? pool.consume(demand) : { cost: 0, consumed: 0 };
      materialCostsPerUnit[m.materialCode] = line.units > 0 ? cost / line.units : 0;
      if (demand - consumed > 1e-6) {
        shortfalls.push({ materialCode: m.materialCode, demand, consumed, shortBy: demand - consumed });
      }
    }
    result.set(line.key, {
      key: line.key,
      materialCostsPerUnit,
      transactionCostsPerUnit: {},
      shortfalls,
      cogPerUnit: 0,
    });
  }

  // ---- Raw-material movements (transfers between facilities, and losses) adjust stock on hand. ----
  // Applied AFTER all production has consumed, so they never re-cost produced lots — they just
  // move / draw down the remaining leftover. A transfer carries its FIFO cost to the destination.
  const ensurePool = (id: string, materialCode: string, facility: string, sku: string | null) => {
    let p = pools.get(id);
    if (!p) pools.set(id, (p = new FifoPool(id, materialCode, facility, sku, [])));
    return p;
  };
  for (const mv of [...rawMovements].sort((a, b) => a.date - b.date || a.seq - b.seq)) {
    if (!(mv.quantity > 0)) continue;
    const pk = materialPoolKey.get(mv.materialCode) ?? (mv.sku ? "FACILITY_SKU" : "FACILITY");
    const from = pools.get(poolId(mv.materialCode, pk, mv.fromFacility, mv.sku));
    const { cost, consumed } = from ? from.consume(mv.quantity) : { cost: 0, consumed: 0 };
    if (mv.toFacility && consumed > 0) {
      const toId = poolId(mv.materialCode, pk, mv.toFacility, mv.sku);
      ensurePool(toId, mv.materialCode, mv.toFacility, mv.sku).addLayer(consumed, cost / consumed);
    }
    // A loss (no destination) just leaves; nothing to add anywhere.
  }

  // Legacy: any lost-inventory purchases not yet migrated to movements (no-op once migrated).
  for (const p of purchases) {
    if (!p.isAdjustment || p.quantity >= 0) continue;
    const pk = materialPoolKey.get(p.materialCode) ?? (p.sku ? "FACILITY_SKU" : "FACILITY");
    pools.get(poolId(p.materialCode, pk, p.facility, p.sku))?.consume(Math.abs(p.quantity));
  }

  // ---- Transaction-based costs, bucketed by category, allocated to lines within a lot. ----
  const linesByLot = new Map<number, EngineLotLine[]>();
  for (const l of lines) (linesByLot.get(l.lotNr) ?? linesByLot.set(l.lotNr, []).get(l.lotNr)!).push(l);

  // accumulate $ per line, per category: category -> (lineKey -> $)
  const byCategory = new Map<string, Map<string, number>>();

  for (const t of transactions) {
    if (!t.appliesToCog) continue;
    const lotLines = linesByLot.get(t.lotNr);
    if (!lotLines || lotLines.length === 0 || !t.applicable) continue;
    const cat = t.category?.trim() || "Other cost";
    const target = byCategory.get(cat) ?? byCategory.set(cat, new Map()).get(cat)!;
    // SKU-scoped line -> attribute to the matching SKU; null sku -> spread across the lot.
    // A SKU tag that matches no current line (the SKU was removed from the lot) is treated as
    // unassigned: skipped entirely, so it drops out of COG until reassigned.
    const matched = t.sku ? lotLines.filter((l) => l.sku === t.sku) : null;
    if (matched && matched.length === 0) continue;
    const recipients = matched ?? lotLines;
    const totalUnits = recipients.reduce((s, l) => s + l.units, 0) || recipients.length;
    for (const l of recipients) {
      const share = recipients.length === 1 ? 1 : (l.units || 1) / totalUnits;
      target.set(l.key, (target.get(l.key) ?? 0) + t.applicable * share);
    }
  }

  for (const line of lines) {
    const lc = result.get(line.key)!;
    const txn: Record<string, number> = {};
    for (const [cat, byLine] of byCategory) {
      const perUnit = line.units > 0 ? (byLine.get(line.key) ?? 0) / line.units : 0;
      if (Math.abs(perUnit) > 1e-9) txn[cat] = perUnit;
    }
    lc.transactionCostsPerUnit = txn;
    const materialsSum = Object.values(lc.materialCostsPerUnit).reduce((s, v) => s + v, 0);
    const txnSum = Object.values(txn).reduce((s, v) => s + v, 0);
    lc.cogPerUnit = materialsSum + txnSum;
  }

  // ---- Remaining inventory per pool. ----
  const poolRemaining: PoolRemaining[] = [];
  for (const [id, pool] of pools) {
    const r = pool.remaining();
    poolRemaining.push({
      poolId: id,
      materialCode: pool.materialCode,
      facility: pool.facility,
      sku: pool.sku,
      quantityRemaining: r.qty,
      valueRemaining: r.value,
    });
  }

  return { lines: result, pools: poolRemaining };
}
