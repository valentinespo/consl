import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { GROUP_ORDER, type Pnl, type PnlGroupBlock } from "@/lib/pnl-shared";

export { GROUP_ORDER, GROUP_LABEL, type Pnl, type PnlGroupBlock, type PnlTypeRow } from "@/lib/pnl-shared";

/**
 * The P&L read side: sum the imported financial ledger by bucket for a date window, price the
 * shipped units with the engine's landed cost — and bridge the settlement lag.
 *
 * Amazon posts an order's money only around delivery (+ up to a week of payout hold), so the most
 * recent ~10 days of order-dated revenue haven't reached the ledger yet. Orders in range with no
 * posted Principal are added as "(pending)" rows: their revenue split comes from the order record
 * itself (exact), their fees from this seller's own per-SKU history (estimate). Every pending row
 * is replaced by the real posted money as Amazon settles — the statement converges to the ledger.
 */

/** UTC instant of local midnight starting `day` (YYYY-MM-DD) in `tz`, DST-safe. */
export function zonedDayStart(day: string, tz: string): Date {
  const guess = new Date(`${day}T00:00:00Z`);
  const offsetAt = (at: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(at);
    const m = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour % 24, +m.minute, +m.second) - at.getTime();
  };
  const first = new Date(guess.getTime() - offsetAt(guess));
  return new Date(guess.getTime() - offsetAt(first)); // second pass settles DST edges
}

/** Inclusive [from-day, to-day] as UTC instants in `tz`. */
export function zonedDayBounds(fromDay: string, toDay: string, tz: string): { from: Date; to: Date } {
  const next = new Date(`${toDay}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { from: zonedDayStart(fromDay, tz), to: new Date(zonedDayStart(next.toISOString().slice(0, 10), tz).getTime() - 1) };
}

/** Weighted-average landed cost per Amazon seller SKU, from lot lines + opening layers. */
async function avgCostBySellerSku(): Promise<Map<string, number>> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return new Map();
  const lot = await prisma.$queryRaw<{ productId: string; cost: number; units: number }[]>`
    SELECT "productId", SUM(units * COALESCE("cogPerUnit", 0)) AS cost, SUM(units) AS units
    FROM "LotLine" WHERE "orgId" = ${orgId} GROUP BY "productId"`;
  const open = await prisma.$queryRaw<{ productId: string; cost: number; units: number }[]>`
    SELECT "productId", SUM(quantity * COALESCE("unitCost", 0)) AS cost, SUM(quantity) AS units
    FROM "StockMovement"
    WHERE "orgId" = ${orgId} AND kind = 'OPENING' AND "itemType" = 'FINISHED' AND "productId" IS NOT NULL
    GROUP BY "productId"`;
  const byProduct = new Map<string, { cost: number; units: number }>();
  for (const r of [...lot, ...open]) {
    const cur = byProduct.get(r.productId) ?? { cost: 0, units: 0 };
    byProduct.set(r.productId, { cost: cur.cost + Number(r.cost), units: cur.units + Number(r.units) });
  }
  const products = await prisma.product.findMany({ select: { id: true, sellerSku: true } });
  const out = new Map<string, number>();
  for (const p of products) {
    const agg = byProduct.get(p.id);
    if (p.sellerSku && agg && agg.units > 0) out.set(p.sellerSku, agg.cost / agg.units);
  }
  return out;
}

type Bridge = {
  sales: { type: string; amount: number }[];
  taxes: number;
  fba: number;
  referral: number;
  cogs: number;
  units: number;
  pendingSales: number;
  unmatchedSkus: Set<string>;
};

/** Orders in range whose shipment money hasn't posted yet → exact revenue + estimated fees. */
async function pendingBridge(from: Date, to: Date, costs: Map<string, number>): Promise<Bridge> {
  const none: Bridge = { sales: [], taxes: 0, fba: 0, referral: 0, cogs: 0, units: 0, pendingSales: 0, unmatchedSkus: new Set() };
  const orgId = await getCurrentOrgId();
  if (!orgId) return none;

  const orders = await prisma.$queryRaw<
    { id: string; total: number; productGross: number | null; discounts: number | null; tax: number | null; shipping: number | null; giftWrap: number | null }[]
  >`
    SELECT so.id, so.total, so."productGross", so.discounts, so.tax, so.shipping, so."giftWrap"
    FROM "SalesOrder" so
    WHERE so."orgId" = ${orgId} AND so.channel = 'AMAZON'
      AND so.cancelled = false AND so.voided = false AND so.total <> 0
      AND so."orderedAt" >= ${from} AND so."orderedAt" <= ${to}
      AND NOT EXISTS (
        SELECT 1 FROM "FinanceEvent" fe
        WHERE fe."orgId" = so."orgId" AND fe.channel = 'AMAZON'
          AND fe."orderId" = so."externalId" AND fe.type = 'Principal'
      )`;
  if (orders.length === 0) return none;

  // Revenue split straight off the order records — exact, not an estimate.
  let principal = 0, promo = 0, tax = 0, shipping = 0, wrap = 0;
  for (const o of orders) {
    if (o.productGross != null) {
      principal += o.productGross;
      promo -= o.discounts ?? 0;
      tax += o.tax ?? 0;
      shipping += o.shipping ?? 0;
      wrap += o.giftWrap ?? 0;
    } else {
      principal += o.total; // fresh order the report hasn't detailed yet — total is what we know
    }
  }

  // Fee estimates from this seller's own posted history, per SKU with an org-wide fallback.
  const [principalHist, fbaHist, commissionHist] = await Promise.all([
    prisma.financeEvent.groupBy({ by: ["sku"], where: { channel: "AMAZON", type: "Principal" }, _sum: { amount: true, quantity: true } }),
    prisma.financeEvent.groupBy({ by: ["sku"], where: { channel: "AMAZON", type: "FBAPerUnitFulfillmentFee" }, _sum: { amount: true } }),
    prisma.financeEvent.groupBy({ by: ["sku"], where: { channel: "AMAZON", type: "Commission" }, _sum: { amount: true } }),
  ]);
  const principalBySku = new Map(principalHist.map((r) => [r.sku ?? "", { amount: r._sum.amount ?? 0, units: r._sum.quantity ?? 0 }]));
  const fbaBySku = new Map(fbaHist.map((r) => [r.sku ?? "", r._sum.amount ?? 0]));
  const commissionBySku = new Map(commissionHist.map((r) => [r.sku ?? "", r._sum.amount ?? 0]));
  const totals = {
    principal: [...principalBySku.values()].reduce((t, v) => t + v.amount, 0),
    units: [...principalBySku.values()].reduce((t, v) => t + v.units, 0),
    fba: [...fbaBySku.values()].reduce((t, v) => t + v, 0),
    commission: [...commissionBySku.values()].reduce((t, v) => t + v, 0),
  };
  const orgFbaPerUnit = totals.units > 0 ? totals.fba / totals.units : 0;
  const orgCommissionRate = totals.principal > 0 ? totals.commission / totals.principal : 0;

  const lines = await prisma.salesOrderLine.findMany({
    where: { orderId: { in: orders.map((o) => o.id) } },
    select: { sku: true, quantity: true, gross: true, unitPrice: true },
  });
  let fba = 0, referral = 0, cogs = 0, units = 0;
  const unmatched = new Set<string>();
  for (const l of lines) {
    const sku = l.sku ?? "";
    const hist = principalBySku.get(sku);
    const fbaPerUnit = hist && hist.units > 0 ? (fbaBySku.get(sku) ?? 0) / hist.units : orgFbaPerUnit;
    const commissionRate = hist && hist.amount > 0 ? (commissionBySku.get(sku) ?? 0) / hist.amount : orgCommissionRate;
    const gross = l.gross || l.quantity * l.unitPrice;
    fba += l.quantity * fbaPerUnit;
    referral += gross * commissionRate;
    units += l.quantity;
    const c = costs.get(sku);
    if (c != null) cogs -= l.quantity * c;
    else if (sku) unmatched.add(sku);
  }

  const sales = [
    { type: "Principal (pending)", amount: principal },
    { type: "ShippingCharge (pending)", amount: shipping },
    { type: "Tax (pending)", amount: tax },
    { type: "GiftWrap (pending)", amount: wrap },
    { type: "Promotion (pending)", amount: promo },
  ].filter((r) => r.amount !== 0);

  return {
    sales,
    taxes: -tax, // the marketplace facilitator withholds what it collects — mirrors settled rows
    fba,
    referral,
    cogs,
    units,
    pendingSales: principal + promo + tax + shipping + wrap,
    unmatchedSkus: unmatched,
  };
}

export async function getPnl(from: Date, to: Date): Promise<Pnl> {
  const where = { channel: "AMAZON", eventAt: { gte: from, lte: to } };

  const sums = await prisma.financeEvent.groupBy({
    by: ["group", "type"],
    where,
    _sum: { amount: true },
  });

  const blocks = new Map<string, { type: string; amount: number }[]>();
  for (const s of sums) {
    const list = blocks.get(s.group) ?? [];
    list.push({ type: s.type, amount: s._sum.amount ?? 0 });
    blocks.set(s.group, list);
  }

  // COGS: shipped units per SKU in the window × the SKU's weighted-average landed cost.
  const qty = await prisma.financeEvent.groupBy({
    by: ["sku"],
    where: { ...where, group: "sales", type: "Principal", quantity: { not: null } },
    _sum: { quantity: true },
  });
  const costs = await avgCostBySellerSku();
  let cogs = 0;
  let unitsSold = 0;
  const unmatched = new Set<string>();
  for (const q of qty) {
    const units = q._sum.quantity ?? 0;
    unitsSold += units;
    const c = q.sku ? costs.get(q.sku) : undefined;
    if (c != null) cogs -= units * c;
    else if (q.sku && units > 0) unmatched.add(q.sku);
  }

  // Bridge the settlement lag: recent orders whose money hasn't posted yet.
  const bridge = await pendingBridge(from, to, costs);
  if (bridge.sales.length) {
    blocks.set("sales", [...(blocks.get("sales") ?? []), ...bridge.sales]);
    if (bridge.taxes !== 0) blocks.set("taxes", [...(blocks.get("taxes") ?? []), { type: "TaxWithheld (pending)", amount: bridge.taxes }]);
    if (bridge.fba !== 0) blocks.set("fba_fees", [...(blocks.get("fba_fees") ?? []), { type: "FBAPerUnitFulfillmentFee (pending)", amount: bridge.fba }]);
    if (bridge.referral !== 0) blocks.set("referral_fees", [...(blocks.get("referral_fees") ?? []), { type: "Commission (pending)", amount: bridge.referral }]);
    cogs += bridge.cogs;
    unitsSold += bridge.units;
    for (const s of bridge.unmatchedSkus) unmatched.add(s);
  }

  const groups: PnlGroupBlock[] = GROUP_ORDER.map((g) => {
    const types = (blocks.get(g) ?? []).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return { group: g, total: types.reduce((t, r) => t + r.amount, 0), types };
  }).filter((b) => b.types.length > 0);

  const sales = groups.find((g) => g.group === "sales")?.total ?? 0;
  const ledgerTotal = groups.reduce((t, g) => t + g.total, 0);
  const netProfit = ledgerTotal + cogs;

  const settings = await prisma.settings.findFirst({ select: { financeBackfillCursor: true } });
  const floor = new Date(Date.now() - 725 * 86_400_000);
  const backfillInProgress = !settings?.financeBackfillCursor || new Date(settings.financeBackfillCursor) > floor;

  return {
    groups,
    sales,
    cogs,
    unitsSold,
    netProfit,
    margin: sales !== 0 ? netProfit / sales : null,
    roi: cogs !== 0 ? netProfit / Math.abs(cogs) : null,
    pendingSales: bridge.pendingSales,
    unmatchedSkus: [...unmatched],
    backfillInProgress,
    hasData: groups.length > 0,
  };
}

/** Oldest posted event — the date picker's lower bound. */
export async function oldestFinanceDate(): Promise<string | null> {
  const first = await prisma.financeEvent.findFirst({ where: { channel: "AMAZON" }, orderBy: { eventAt: "asc" }, select: { eventAt: true } });
  return first ? first.eventAt.toISOString().slice(0, 10) : null;
}
