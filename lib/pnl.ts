import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { GROUP_ORDER, type Pnl, type PnlChannel, type PnlGroupBlock } from "@/lib/pnl-shared";
import { getCurrentOrg } from "@/lib/org";
import { fxRate } from "@/lib/fx";
import { computeFinishedGoods } from "@/lib/queries";
import { activeExclusions } from "@/lib/order-metrics";

export { GROUP_ORDER, GROUP_LABEL, PNL_CHANNEL_LABEL, type Pnl, type PnlChannel, type PnlGroupBlock, type PnlTypeRow } from "@/lib/pnl-shared";

/**
 * The P&L read side, across channels: sum each channel's financial ledger by bucket for a date
 * window, price every unit sold first-in-first-out from ONE queue per product — what was shipped
 * to Amazon, since that is where the units physically leave from whichever channel sold them
 * (Amazon's own orders, and Shopify's and TikTok's shipped through MCF) — and bridge each
 * channel's settlement lag.
 *
 * Ledgers: Amazon's Finances feed, TikTok's settlement statements, and Shopify's orders (written
 * as ledger rows at import — Shopify has no separate money feed). Units for cost of goods come
 * from Amazon's posted sale rows, and from the order lines themselves for Shopify and TikTok
 * (a $0 sample still leaves the warehouse). Amazon's MCF shipments post no sale, only their
 * fulfilment fee — so a TikTok or Shopify sale shipped by Amazon is counted once, on its own
 * channel, and the MCF fee still lands under Amazon's fees.
 *
 * Scope: the products the company keeps in consl. Listings it never mapped are left out entirely
 * — their sales, fees, refunds and units alike — so the statement never shows revenue it can't
 * cost. Money with no SKU on it (ad invoices, storage bills) is the account's and always counts.
 * Orders the double-count rule drops on the Orders tab (Shopify mirrors of a present channel)
 * are dropped here too. Amounts are the company's currency (`baseAmount`).
 *
 * Settlement lag: Amazon books an order's money when it ships, TikTok when it is delivered, so
 * orders placed before that are missing from those ledgers. They are added as "(pending)" rows:
 * the revenue from the order record itself (exact), the fees from the seller's own history
 * (estimate); every pending row is replaced by the real posted money the moment it lands.
 */

export const PNL_CHANNELS: PnlChannel[] = ["AMAZON", "SHOPIFY", "TIKTOK"];

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

/** Channels with anything to show — a ledger, or orders. */
export async function presentPnlChannels(): Promise<PnlChannel[]> {
  const [ledger, orders] = await Promise.all([prisma.financeEvent.groupBy({ by: ["channel"] }), prisma.salesOrder.groupBy({ by: ["channel"] })]);
  const seen = new Set([...ledger.map((r) => r.channel), ...orders.map((r) => r.channel)]);
  return PNL_CHANNELS.filter((c) => seen.has(c));
}

type ProductCost = { id: string; code: string; openingUnitCost: number | null; preConslUnitCost: number | null };
/** The statement's scope: the company's products, keyed the way each channel's ledger names them. */
type Scope = { amazon: Map<string, ProductCost>; tiktok: Map<string, ProductCost>; byId: Map<string, ProductCost> };

async function loadScope(): Promise<Scope> {
  const products = await prisma.product.findMany({
    select: { id: true, code: true, sellerSku: true, tiktokSku: true, openingUnitCost: true, preConslUnitCost: true },
  });
  const scope: Scope = { amazon: new Map(), tiktok: new Map(), byId: new Map() };
  for (const p of products) {
    const cost = { id: p.id, code: p.code, openingUnitCost: p.openingUnitCost, preConslUnitCost: p.preConslUnitCost };
    scope.byId.set(p.id, cost);
    if (p.sellerSku) scope.amazon.set(p.sellerSku, cost);
    if (p.tiktokSku) scope.tiktok.set(p.tiktokSku, cost);
  }
  return scope;
}

/** One sale to price: units of a product on a channel at an instant (null = not posted yet — goes last). */
type Sale = { productId: string; units: number; at: number | null; channel: PnlChannel };
type Cogs = { cogs: number; units: number; preHistoryUnits: number; overflowUnits: number; unmatchedSkus: Set<string> };

/**
 * Cost of goods, first-in-first-out from one queue of units per product.
 *
 * Everything that ever entered Amazon — each lot's shipment at that lot's landed cost, plus a
 * company's day-zero starting stock — lines up by date, oldest first. Every sale on record, from
 * every channel, is then replayed in date order from the very first one, each taking units from
 * the front of the queue; the walk always starts at the beginning so that by the time it reaches
 * the window it knows exactly which units were already gone. The window's COGS is what the
 * selected channels' sales consumed there. Pending sales (not posted yet) join the end.
 *
 * Sales before a product's first recorded layer are pre-history (day-zero stock can't be eaten
 * by sales that predate it): they're priced at the product's pre-consl average cost (set from
 * the P&L; the starting cost, then the oldest layer, stand in until then) and counted in
 * `preHistoryUnits`. Sales beyond everything recorded take the newest layer's cost and count in
 * `overflowUnits` — never silently zero.
 */
async function fifoCogs(sales: Sale[], from: Date, to: Date, selected: Set<PnlChannel>, scope: Scope): Promise<Cogs> {
  const { shipped } = await computeFinishedGoods();
  type Layer = { units: number; unitCost: number; date: number };
  const queue = new Map<string, Layer[]>();
  for (const l of shipped) {
    if (l.destination !== "AMAZON" || l.units <= 0) continue;
    const list = queue.get(l.sku) ?? []; // `sku` here is the product id
    list.push({ units: l.units, unitCost: l.unitCost, date: l.date });
    queue.set(l.sku, list);
  }
  for (const list of queue.values()) list.sort((a, b) => a.date - b.date);

  const cursor = new Map<string, { idx: number; left: number }>();
  const out: Cogs = { cogs: 0, units: 0, preHistoryUnits: 0, overflowUnits: 0, unmatchedSkus: new Set() };
  const order = (s: Sale) => s.at ?? Number.MAX_SAFE_INTEGER;
  for (const sale of [...sales].sort((a, b) => order(a) - order(b))) {
    const product = scope.byId.get(sale.productId);
    if (!product) continue;
    const qty = sale.units;
    const at = sale.at;
    const inWindow = selected.has(sale.channel) && (at == null || (at >= from.getTime() && at <= to.getTime()));
    const layers = queue.get(product.id) ?? [];
    const preConsl = product.preConslUnitCost ?? product.openingUnitCost ?? layers[0]?.unitCost ?? null;
    if (inWindow) out.units += qty;
    // Pre-history: nothing recorded had entered the channel yet, so nothing is consumed.
    const preHistory = at != null && layers.length > 0 && at < layers[0].date;
    if (layers.length === 0 || preHistory) {
      if (!inWindow) continue;
      if (preConsl == null) out.unmatchedSkus.add(product.code);
      else {
        out.cogs -= qty * preConsl;
        out.preHistoryUnits += qty;
      }
      continue;
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
      // Sold more than was ever recorded entering the channel — most likely the newest shipment
      // wasn't recorded, so the rest carries the newest cost on record.
      const newest = layers[layers.length - 1]?.unitCost ?? preConsl;
      if (newest == null) out.unmatchedSkus.add(product.code);
      else {
        out.cogs -= want * newest;
        out.overflowUnits += want;
      }
    }
    cursor.set(product.id, c);
  }
  return out;
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

/** TikTok orders in range that no statement transaction covers yet (placed, not delivered): the
 *  sale from the order (what the buyer paid for the goods after the seller's discount, plus the
 *  shipping they paid), the fees at this shop's own historical rate. Units are NOT added here —
 *  every TikTok order's lines already drive cost of goods. */
async function tiktokPendingBridge(orgId: string, from: Date, to: Date, baseCurrency: string): Promise<{ sales: number; fees: number }> {
  const orders = await prisma.$queryRaw<
    { total: number; currency: string; orderedAt: Date; productGross: number | null; discounts: number | null; shipping: number | null; sourceData: unknown }[]
  >`
    SELECT so.total, so.currency, so."orderedAt", so."productGross", so.discounts, so.shipping, so."sourceData"
    FROM "SalesOrder" so
    WHERE so."orgId" = ${orgId} AND so.channel = 'TIKTOK'
      AND so.cancelled = false AND so.voided = false AND so.total <> 0
      AND so."orderedAt" >= ${from} AND so."orderedAt" <= ${to}
      AND NOT EXISTS (
        SELECT 1 FROM "FinanceEvent" fe
        WHERE fe."orgId" = so."orgId" AND fe.channel = 'TIKTOK' AND fe."orderId" = so."externalId")`;
  if (orders.length === 0) return { sales: 0, fees: 0 };
  const hist = await prisma.financeEvent.groupBy({ by: ["group"], where: { channel: "TIKTOK" }, _sum: { baseAmount: true } });
  const histSales = hist.filter((h) => h.group === "sales").reduce((t, h) => t + (h._sum.baseAmount ?? 0), 0);
  const histFees = hist.filter((h) => ["referral_fees", "payment_fees", "advertising", "other"].includes(h.group)).reduce((t, h) => t + (h._sum.baseAmount ?? 0), 0);
  const rate = histSales > 0 ? Math.abs(histFees) / histSales : 0;
  let sales = 0;
  for (const o of orders) {
    const sd = o.sourceData as { payment?: { sub_total?: string | null } } | null;
    const goods = sd?.payment?.sub_total != null ? Number(sd.payment.sub_total) : (o.productGross ?? 0) - (o.discounts ?? 0);
    const fx = o.currency === baseCurrency ? 1 : await fxRate(o.currency, baseCurrency, o.orderedAt);
    sales += (Math.max(0, goods) + (o.shipping ?? 0)) * fx;
  }
  return { sales, fees: -sales * rate };
}

const EMPTY: Pnl = {
  groups: [], sales: 0, cogs: 0, unitsSold: 0, netProfit: 0, margin: null, roi: null, pending: [],
  unmatchedSkus: [], preHistoryUnits: 0, overflowUnits: 0, ignored: { skus: [], units: 0, sales: 0 }, backfillInProgress: false, hasData: false,
};

/** The statement for a window, over the given channels (default: every channel with data). */
export async function getPnl(from: Date, to: Date, channels?: PnlChannel[]): Promise<Pnl> {
  const orgId = await getCurrentOrgId();
  const present = await presentPnlChannels();
  const selected = (channels ?? present).filter((c) => present.includes(c));
  const selectedSet = new Set(selected);
  if (!orgId || selected.length === 0) return EMPTY;
  const [scope, org, exclusions] = await Promise.all([loadScope(), getCurrentOrg(), activeExclusions()]);
  const baseCurrency = org?.currencyCode ?? "USD";
  const excludedSources = exclusions.sources;
  const amazonSkus = [...scope.amazon.keys()];
  const tiktokSkus = [...scope.tiktok.keys()];
  const lineChannels = selected.filter((c) => c !== "AMAZON");

  // The ledgers, by bucket. Amazon and TikTok rows are scoped by the SKU they name; Shopify rows
  // exist only for managed lines. A Shopify order the Orders tab drops is dropped here too.
  const sums = await prisma.$queryRaw<{ group: string; type: string; amount: number }[]>`
    SELECT fe."group", fe."type", COALESCE(SUM(fe."baseAmount"), 0)::float8 AS amount
    FROM "FinanceEvent" fe
    WHERE fe."orgId" = ${orgId} AND fe.channel = ANY(${selected}::text[])
      AND fe."eventAt" >= ${from} AND fe."eventAt" <= ${to}
      AND (fe.sku IS NULL OR fe.channel = 'SHOPIFY'
        OR (fe.channel = 'AMAZON' AND fe.sku = ANY(${amazonSkus}::text[]))
        OR (fe.channel = 'TIKTOK' AND fe.sku = ANY(${tiktokSkus}::text[])))
      AND NOT (fe.channel = 'SHOPIFY' AND EXISTS (
        SELECT 1 FROM "SalesOrder" so
        WHERE so."orgId" = fe."orgId" AND so.channel = 'SHOPIFY' AND so."externalId" = fe."orderId"
          AND (so.voided OR so.source = ANY(${excludedSources}::text[]))))
    GROUP BY 1, 2`;
  const blocks = new Map<string, { type: string; amount: number }[]>();
  const add = (group: string, type: string, amount: number) => blocks.set(group, [...(blocks.get(group) ?? []), { type, amount }]);
  for (const s of sums) add(s.group, s.type, s.amount);

  // Custom fees the operator attached (by rule or by hand): a cost on the order's own channel. A
  // fee counts whenever its order counts; on an MCF order it always counts (the fee is a real
  // cost even though that order's revenue lives on another channel); on a Shopify order the
  // double-count rule drops, only a hand-written fee counts.
  const feeRows = await prisma.$queryRaw<{ name: string; currency: string; amount: number; orderedAt: Date }[]>`
    SELECT f.name, o.currency, f.amount::float8 AS amount, o."orderedAt"
    FROM "OrderFee" f JOIN "SalesOrder" o ON o.id = f."orderId"
    WHERE o."orgId" = ${orgId} AND o.channel = ANY(${selected}::text[])
      AND o."orderedAt" >= ${from} AND o."orderedAt" <= ${to}
      AND o.cancelled = false AND o.voided = false
      AND (f."ruleId" IS NULL OR o.mcf OR NOT (o.channel = 'SHOPIFY' AND o.source = ANY(${excludedSources}::text[])))`;
  const feeByName = new Map<string, number>();
  for (const f of feeRows) {
    const fx = f.currency === baseCurrency ? 1 : await fxRate(f.currency, baseCurrency, f.orderedAt);
    feeByName.set(f.name, (feeByName.get(f.name) ?? 0) - f.amount * fx);
  }
  for (const [name, amount] of feeByName) add("custom_fees", name, amount);

  // What the scope left out: listings sold that the company doesn't manage here.
  const ignored = { skus: [] as string[], units: 0, sales: 0 };
  if (selectedSet.has("AMAZON")) {
    const left = await prisma.financeEvent.groupBy({
      by: ["sku"],
      where: { channel: "AMAZON", eventAt: { gte: from, lte: to }, group: "sales", type: "Principal", sku: { notIn: amazonSkus, not: null } },
      _sum: { quantity: true, baseAmount: true },
    });
    for (const r of left) {
      ignored.skus.push(r.sku as string);
      ignored.units += r._sum.quantity ?? 0;
      ignored.sales += r._sum.baseAmount ?? 0;
    }
  }
  if (lineChannels.length) {
    const left = await prisma.$queryRaw<{ sku: string | null; units: number; sales: number }[]>`
      SELECT l.sku, SUM(l.quantity)::int AS units, COALESCE(SUM(l.quantity * l."unitPrice"), 0)::float8 AS sales
      FROM "SalesOrderLine" l JOIN "SalesOrder" o ON o.id = l."orderId"
      WHERE o."orgId" = ${orgId} AND o.channel = ANY(${lineChannels}::text[]) AND l."productId" IS NULL
        AND o.cancelled = false AND o.voided = false AND o."orderedAt" >= ${from} AND o."orderedAt" <= ${to}
        AND NOT (o.channel = 'SHOPIFY' AND o.source = ANY(${excludedSources}::text[]))
      GROUP BY 1`;
    for (const r of left) {
      if (r.sku && !ignored.skus.includes(r.sku)) ignored.skus.push(r.sku);
      ignored.units += r.units;
      ignored.sales += r.sales;
    }
  }
  ignored.skus.sort();

  // Bridge each channel's settlement lag.
  const pending: Pnl["pending"] = [];
  const pendingSales: Sale[] = [];
  if (selectedSet.has("AMAZON")) {
    const bridge = await pendingBridge(from, to, new Set(amazonSkus), baseCurrency);
    if (bridge.sales.length) {
      for (const s of bridge.sales) add("sales", s.type, s.amount);
      if (bridge.taxes !== 0) add("taxes", "TaxWithheld (pending)", bridge.taxes);
      if (bridge.fba !== 0) add("fba_fees", "FBAPerUnitFulfillmentFee (pending)", bridge.fba);
      if (bridge.referral !== 0) add("referral_fees", "Commission (pending)", bridge.referral);
      pending.push({ channel: "AMAZON", sales: bridge.pendingSales });
    }
    for (const l of bridge.lines) {
      const p = scope.amazon.get(l.sku);
      if (p) pendingSales.push({ productId: p.id, units: l.units, at: null, channel: "AMAZON" });
    }
  }
  if (selectedSet.has("TIKTOK")) {
    const bridge = await tiktokPendingBridge(orgId, from, to, baseCurrency);
    if (bridge.sales !== 0) {
      add("sales", "Sales (pending)", bridge.sales);
      if (bridge.fees !== 0) add("referral_fees", "Fees (pending)", bridge.fees);
      pending.push({ channel: "TIKTOK", sales: bridge.sales });
    }
  }

  // Every sale on record, from every channel — the FIFO walk needs all of history.
  const amazonRows = await prisma.financeEvent.findMany({
    where: { channel: "AMAZON", group: "sales", type: "Principal", quantity: { not: null }, sku: { in: amazonSkus } },
    select: { sku: true, quantity: true, eventAt: true },
    orderBy: [{ eventAt: "asc" }, { id: "asc" }],
  });
  const sales: Sale[] = [];
  for (const r of amazonRows) {
    const p = scope.amazon.get(r.sku as string);
    if (p) sales.push({ productId: p.id, units: r.quantity ?? 0, at: r.eventAt.getTime(), channel: "AMAZON" });
  }
  const lineRows = await prisma.$queryRaw<{ channel: string; productId: string; units: number; at: Date }[]>`
    SELECT o.channel, l."productId", l.quantity::int AS units, o."orderedAt" AS at
    FROM "SalesOrderLine" l JOIN "SalesOrder" o ON o.id = l."orderId"
    WHERE o."orgId" = ${orgId} AND o.channel IN ('SHOPIFY', 'TIKTOK') AND l."productId" IS NOT NULL
      AND o.cancelled = false AND o.voided = false
      AND NOT (o.channel = 'SHOPIFY' AND o.source = ANY(${excludedSources}::text[]))`;
  for (const r of lineRows) sales.push({ productId: r.productId, units: r.units, at: r.at.getTime(), channel: r.channel as PnlChannel });

  const fifo = await fifoCogs([...sales, ...pendingSales], from, to, selectedSet, scope);

  const groups: PnlGroupBlock[] = GROUP_ORDER.map((g) => {
    const types = (blocks.get(g) ?? []).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return { group: g, total: types.reduce((t, r) => t + r.amount, 0), types };
  }).filter((b) => b.types.length > 0);

  const salesTotal = groups.find((g) => g.group === "sales")?.total ?? 0;
  const ledgerTotal = groups.reduce((t, g) => t + g.total, 0);
  const netProfit = ledgerTotal + fifo.cogs;

  const settings = await prisma.settings.findFirst({ select: { financeBackfillCursor: true } });
  const floor = new Date(Date.now() - 725 * 86_400_000);
  const backfillInProgress = selectedSet.has("AMAZON") && (!settings?.financeBackfillCursor || new Date(settings.financeBackfillCursor) > floor);

  return {
    groups,
    sales: salesTotal,
    cogs: fifo.cogs,
    unitsSold: fifo.units,
    netProfit,
    margin: salesTotal !== 0 ? netProfit / salesTotal : null,
    roi: fifo.cogs !== 0 ? netProfit / Math.abs(fifo.cogs) : null,
    pending: pending.filter((p) => p.sales > 0),
    unmatchedSkus: [...fifo.unmatchedSkus],
    preHistoryUnits: fifo.preHistoryUnits,
    overflowUnits: fifo.overflowUnits,
    ignored,
    backfillInProgress,
    hasData: groups.length > 0 || fifo.units > 0,
  };
}

/** Oldest dated money or order across the channels — the date picker's lower bound. */
export async function oldestFinanceDate(): Promise<string | null> {
  const [fe, so] = await Promise.all([
    prisma.financeEvent.findFirst({ orderBy: { eventAt: "asc" }, select: { eventAt: true } }),
    prisma.salesOrder.findFirst({ where: { channel: { in: ["SHOPIFY", "TIKTOK"] } }, orderBy: { orderedAt: "asc" }, select: { orderedAt: true } }),
  ]);
  const dates = [fe?.eventAt, so?.orderedAt].filter((d): d is Date => !!d);
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((d) => d.getTime()))).toISOString().slice(0, 10);
}
