import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { GROUP_ORDER, type Pnl, type PnlGroupBlock } from "@/lib/pnl-shared";
import { getCurrentOrg } from "@/lib/org";
import { fxRate } from "@/lib/fx";
import { computeFinishedGoods } from "@/lib/queries";

export { GROUP_ORDER, GROUP_LABEL, type Pnl, type PnlGroupBlock, type PnlTypeRow } from "@/lib/pnl-shared";

/**
 * The P&L read side: sum the imported financial ledger by bucket for a date window, price the
 * units sold first-in-first-out from what was actually shipped to the channel — and bridge the
 * settlement lag.
 *
 * Scope: the products the company keeps in consl. Listings it never mapped (ignored at
 * onboarding, or a sister listing it doesn't manage here) are left out entirely — their sales,
 * fees, refunds and units alike — so the statement never shows revenue it can't cost. Money with
 * no SKU on it (ad invoices, storage bills, subscriptions) is the account's and always counts.
 * Amounts are the company's currency (`baseAmount`), so a Canadian sale adds up with a US one.
 *
 * Amazon books an order's money when it ships (held for payout, but exact), so only orders placed
 * and not yet shipped are missing from the ledger. Those are added as "(pending)" rows: their
 * revenue split comes from the order record itself (exact), their fees from this seller's own
 * per-SKU history (estimate). Every pending row is replaced by the real posted money the moment
 * the order ships — the statement converges to the ledger within a day or two.
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

type Cogs = { cogs: number; units: number; fallbackUnits: number; unmatchedSkus: Set<string> };

/**
 * Cost of goods, first-in-first-out from the channel's own queue of units.
 *
 * Everything that ever entered Amazon — each lot's shipment at that lot's landed cost, plus a
 * company's day-zero starting stock — lines up by date, oldest first. Every sale on record is
 * then replayed in date order from the very first one, each taking units from the front of the
 * queue; the walk always starts at the beginning so that by the time it reaches the window it
 * knows exactly which units were already gone. The window's COGS is what its sales consumed.
 * `pending` (orders in the window not yet posted) joins the end of the same walk.
 *
 * Sales before a product's first recorded layer are pre-history (day-zero stock can't be eaten
 * by sales that predate it): they're priced at the oldest cost on record and counted in
 * `fallbackUnits`, as are sales beyond everything recorded — never silently zero.
 */
async function fifoCogs(from: Date, to: Date, scope: Set<string>, pending: { sku: string; units: number }[]): Promise<Cogs> {
  const [{ shipped }, products] = await Promise.all([
    computeFinishedGoods(),
    prisma.product.findMany({ where: { sellerSku: { not: null } }, select: { id: true, sellerSku: true, openingUnitCost: true } }),
  ]);
  const productBySku = new Map(products.map((p) => [p.sellerSku as string, p]));
  type Layer = { units: number; unitCost: number; date: number };
  const queue = new Map<string, Layer[]>();
  for (const l of shipped) {
    if (l.destination !== "AMAZON" || l.units <= 0) continue;
    const list = queue.get(l.sku) ?? [];
    list.push({ units: l.units, unitCost: l.unitCost, date: l.date });
    queue.set(l.sku, list);
  }
  for (const list of queue.values()) list.sort((a, b) => a.date - b.date);

  const cursor = new Map<string, { idx: number; left: number }>();
  const out: Cogs = { cogs: 0, units: 0, fallbackUnits: 0, unmatchedSkus: new Set() };
  const consume = (sku: string, qty: number, at: number | null, inWindow: boolean) => {
    const product = productBySku.get(sku);
    if (!product) return;
    const layers = queue.get(product.id) ?? [];
    const fallback = layers[0]?.unitCost ?? product.openingUnitCost ?? null;
    if (inWindow) out.units += qty;
    // Pre-history: nothing recorded had entered the channel yet, so nothing is consumed.
    const preHistory = at != null && layers.length > 0 && at < layers[0].date;
    if (layers.length === 0 || preHistory) {
      if (!inWindow) return;
      if (fallback == null) out.unmatchedSkus.add(sku);
      else {
        out.cogs -= qty * fallback;
        out.fallbackUnits += qty;
      }
      return;
    }
    const c = cursor.get(product.id) ?? { idx: 0, left: layers[0].units };
    let want = qty;
    while (want > 1e-9 && c.idx < layers.length) {
      const take = Math.min(c.left, want);
      if (inWindow) out.cogs -= take * layers[c.idx].unitCost;
      c.left -= take;
      want -= take;
      if (c.left <= 1e-9) {
        c.idx++;
        c.left = c.idx < layers.length ? layers[c.idx].units : 0;
      }
    }
    if (want > 1e-9 && inWindow) {
      // Sold more than was ever recorded entering the channel — carry the rest at the oldest cost.
      out.cogs -= want * (fallback ?? 0);
      if (fallback == null) out.unmatchedSkus.add(sku);
      else out.fallbackUnits += want;
    }
    cursor.set(product.id, c);
  };

  // Every posted sale on record, oldest first — the walk must start at the beginning.
  const sales = await prisma.financeEvent.findMany({
    where: { channel: "AMAZON", group: "sales", type: "Principal", quantity: { not: null }, sku: { in: [...scope] } },
    select: { sku: true, quantity: true, eventAt: true },
    orderBy: [{ eventAt: "asc" }, { id: "asc" }],
  });
  for (const sale of sales) {
    const at = sale.eventAt.getTime();
    consume(sale.sku as string, sale.quantity ?? 0, at, at >= from.getTime() && at <= to.getTime());
  }
  // Orders in the window whose money hasn't posted: the newest sales, so they go last.
  for (const line of pending) consume(line.sku, line.units, null, true);
  return out;
}

/** Amazon seller SKUs the company manages in consl — the statement's scope. */
async function mappedSellerSkus(): Promise<Set<string>> {
  const products = await prisma.product.findMany({ where: { sellerSku: { not: null } }, select: { sellerSku: true } });
  return new Set(products.map((p) => p.sellerSku as string));
}

/** Prisma filter: rows about one of `skus`, or about no SKU at all (account-level money). */
function inScope(skus: Set<string>) {
  return { OR: [{ sku: null }, { sku: { in: [...skus] } }] };
}

type Bridge = {
  sales: { type: string; amount: number }[];
  taxes: number;
  fba: number;
  referral: number;
  /** Units per SKU, for the FIFO walk to price. */
  lines: { sku: string; units: number }[];
  pendingSales: number;
};

/** Orders in range whose shipment money hasn't posted yet → exact revenue + estimated fees. */
async function pendingBridge(from: Date, to: Date, scope: Set<string>, baseCurrency: string): Promise<Bridge> {
  const none: Bridge = { sales: [], taxes: 0, fba: 0, referral: 0, lines: [], pendingSales: 0 };
  const orgId = await getCurrentOrgId();
  if (!orgId) return none;

  const candidates = await prisma.$queryRaw<
    { id: string; total: number; currency: string; orderedAt: Date; productGross: number | null; discounts: number | null; tax: number | null; shipping: number | null; giftWrap: number | null }[]
  >`
    SELECT so.id, so.total, so.currency, so."orderedAt", so."productGross", so.discounts, so.tax, so.shipping, so."giftWrap"
    FROM "SalesOrder" so
    WHERE so."orgId" = ${orgId} AND so.channel = 'AMAZON'
      AND so.cancelled = false AND so.voided = false AND so.total <> 0
      AND so."orderedAt" >= ${from} AND so."orderedAt" <= ${to}
      AND NOT EXISTS (
        SELECT 1 FROM "FinanceEvent" fe
        WHERE fe."orgId" = so."orgId" AND fe.channel = 'AMAZON'
          AND fe."orderId" = so."externalId" AND fe.type = 'Principal'
      )`;
  if (candidates.length === 0) return none;

  // An order is in scope when at least one of its lines is a product the company manages here.
  const allLines = await prisma.salesOrderLine.findMany({
    where: { orderId: { in: candidates.map((o) => o.id) } },
    select: { orderId: true, sku: true, quantity: true, gross: true, unitPrice: true },
  });
  const inScopeOrders = new Set(allLines.filter((l) => l.sku && scope.has(l.sku)).map((l) => l.orderId));
  const orders = candidates.filter((o) => inScopeOrders.has(o.id));
  if (orders.length === 0) return none;

  // Revenue split straight off the order records — exact, not an estimate — in the company's
  // currency (a sister-marketplace order converts at its day's reference rate).
  let principal = 0, promo = 0, tax = 0, shipping = 0, wrap = 0;
  const rateOf = new Map<string, number>();
  for (const o of orders) {
    const fx = o.currency === baseCurrency ? 1 : await fxRate(o.currency, baseCurrency, o.orderedAt);
    rateOf.set(o.id, fx);
    if (o.productGross != null) {
      principal += o.productGross * fx;
      promo -= (o.discounts ?? 0) * fx;
      tax += (o.tax ?? 0) * fx;
      shipping += (o.shipping ?? 0) * fx;
      wrap += (o.giftWrap ?? 0) * fx;
    } else {
      principal += o.total * fx; // fresh order the report hasn't detailed yet — total is what we know
    }
  }

  // Fee estimates from this seller's own posted history, per SKU with an org-wide fallback.
  const [principalHist, fbaHist, commissionHist] = await Promise.all([
    prisma.financeEvent.groupBy({ by: ["sku"], where: { channel: "AMAZON", type: "Principal" }, _sum: { baseAmount: true, quantity: true } }),
    prisma.financeEvent.groupBy({ by: ["sku"], where: { channel: "AMAZON", type: "FBAPerUnitFulfillmentFee" }, _sum: { baseAmount: true } }),
    prisma.financeEvent.groupBy({ by: ["sku"], where: { channel: "AMAZON", type: "Commission" }, _sum: { baseAmount: true } }),
  ]);
  const principalBySku = new Map(principalHist.map((r) => [r.sku ?? "", { amount: r._sum.baseAmount ?? 0, units: r._sum.quantity ?? 0 }]));
  const fbaBySku = new Map(fbaHist.map((r) => [r.sku ?? "", r._sum.baseAmount ?? 0]));
  const commissionBySku = new Map(commissionHist.map((r) => [r.sku ?? "", r._sum.baseAmount ?? 0]));
  const totals = {
    principal: [...principalBySku.values()].reduce((t, v) => t + v.amount, 0),
    units: [...principalBySku.values()].reduce((t, v) => t + v.units, 0),
    fba: [...fbaBySku.values()].reduce((t, v) => t + v, 0),
    commission: [...commissionBySku.values()].reduce((t, v) => t + v, 0),
  };
  const orgFbaPerUnit = totals.units > 0 ? totals.fba / totals.units : 0;
  const orgCommissionRate = totals.principal > 0 ? totals.commission / totals.principal : 0;

  // Lines of in-scope orders, in-scope SKUs only (a mixed order's unmanaged line carries no fee
  // or cost here; its order-level revenue split above is the one approximation this makes).
  const lines = allLines.filter((l) => inScopeOrders.has(l.orderId) && l.sku && scope.has(l.sku));
  let fba = 0, referral = 0;
  const pendingLines: { sku: string; units: number }[] = [];
  for (const l of lines) {
    const sku = l.sku ?? "";
    const fx = rateOf.get(l.orderId) ?? 1;
    const hist = principalBySku.get(sku);
    const fbaPerUnit = hist && hist.units > 0 ? (fbaBySku.get(sku) ?? 0) / hist.units : orgFbaPerUnit;
    const commissionRate = hist && hist.amount > 0 ? (commissionBySku.get(sku) ?? 0) / hist.amount : orgCommissionRate;
    const gross = (l.gross || l.quantity * l.unitPrice) * fx;
    fba += l.quantity * fbaPerUnit;
    referral += gross * commissionRate;
    pendingLines.push({ sku, units: l.quantity });
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
    lines: pendingLines,
    pendingSales: principal + promo + tax + shipping + wrap,
  };
}

export async function getPnl(from: Date, to: Date): Promise<Pnl> {
  const scope = await mappedSellerSkus();
  const baseCurrency = (await getCurrentOrg())?.currencyCode ?? "USD";
  const window = { channel: "AMAZON", eventAt: { gte: from, lte: to } };
  const where = { ...window, ...inScope(scope) };

  const sums = await prisma.financeEvent.groupBy({
    by: ["group", "type"],
    where,
    _sum: { baseAmount: true },
  });

  const blocks = new Map<string, { type: string; amount: number }[]>();
  for (const s of sums) {
    const list = blocks.get(s.group) ?? [];
    list.push({ type: s.type, amount: s._sum.baseAmount ?? 0 });
    blocks.set(s.group, list);
  }

  // What the scope left out: listings sold on Amazon that the company doesn't manage here.
  const left = await prisma.financeEvent.groupBy({
    by: ["sku"],
    where: { ...window, group: "sales", type: "Principal", sku: { notIn: [...scope], not: null } },
    _sum: { quantity: true, baseAmount: true },
  });
  const ignored = {
    skus: left.map((r) => r.sku as string).sort(),
    units: left.reduce((t, r) => t + (r._sum.quantity ?? 0), 0),
    sales: left.reduce((t, r) => t + (r._sum.baseAmount ?? 0), 0),
  };

  // Bridge the settlement lag: recent orders whose money hasn't posted yet.
  const bridge = await pendingBridge(from, to, scope, baseCurrency);
  if (bridge.sales.length) {
    blocks.set("sales", [...(blocks.get("sales") ?? []), ...bridge.sales]);
    if (bridge.taxes !== 0) blocks.set("taxes", [...(blocks.get("taxes") ?? []), { type: "TaxWithheld (pending)", amount: bridge.taxes }]);
    if (bridge.fba !== 0) blocks.set("fba_fees", [...(blocks.get("fba_fees") ?? []), { type: "FBAPerUnitFulfillmentFee (pending)", amount: bridge.fba }]);
    if (bridge.referral !== 0) blocks.set("referral_fees", [...(blocks.get("referral_fees") ?? []), { type: "Commission (pending)", amount: bridge.referral }]);
  }

  // Cost of goods: first-in-first-out from what was shipped to Amazon (pending units go last).
  const fifo = await fifoCogs(from, to, scope, bridge.lines);
  const cogs = fifo.cogs;
  const unitsSold = fifo.units;
  const unmatched = fifo.unmatchedSkus;

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
    fallbackUnits: fifo.fallbackUnits,
    ignored,
    backfillInProgress,
    hasData: groups.length > 0,
  };
}

/** Oldest posted event — the date picker's lower bound. */
export async function oldestFinanceDate(): Promise<string | null> {
  const first = await prisma.financeEvent.findFirst({ where: { channel: "AMAZON" }, orderBy: { eventAt: "asc" }, select: { eventAt: true } });
  return first ? first.eventAt.toISOString().slice(0, 10) : null;
}
