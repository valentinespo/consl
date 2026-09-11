import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { GROUP_ORDER, type Pnl, type PnlChannel, type PnlGroupBlock } from "@/lib/pnl-shared";
import { getCurrentOrg } from "@/lib/org";
import { fxRate } from "@/lib/fx";
import { computeFinishedGoods } from "@/lib/queries";
import { activeExclusions } from "@/lib/order-metrics";
import { IMPORTER_VERSIONS, importerVersion } from "@/lib/import-versions";

export { GROUP_ORDER, GROUP_LABEL, PNL_CHANNEL_LABEL, type Pnl, type PnlChannel, type PnlGroupBlock, type PnlTypeRow } from "@/lib/pnl-shared";

/**
 * The P&L read side, across channels: sum each channel's financial ledger by bucket for a date
 * window, price every unit sold first-in-first-out from the queue of the PLACE it shipped from,
 * and bridge each channel's settlement lag.
 *
 * Ledgers: Amazon's Finances feed, TikTok's settlement statements, and Shopify's orders (written
 * as ledger rows at import — Shopify has no separate money feed). Units for cost of goods come
 * from Amazon's posted sale rows, and from the order lines themselves for Shopify and TikTok
 * (a $0 sample still leaves the warehouse).
 *
 * Queues: one per product per place. A channel's stock (Amazon FBA/AWD, a Shopify- or
 * TikTok-run warehouse) is what was shipped to that channel; one of the company's own facilities
 * is everything that ever entered it — lots finished there, transfers in, its day-zero balance —
 * minus what left it for somewhere else. Each sale takes its units from the queue of the
 * facility its order was fulfilled from (the operator's correction winning), found on the order
 * record — an Amazon sale row is looked up by its order id. An order placed nowhere prices
 * nothing: its units are reported as unplaced, never guessed onto Amazon.
 *
 * MCF: Amazon's MCF shipments post no sale, only their fulfilment fee. With another channel
 * present, the TikTok or Shopify order that sold the unit carries it, counted once, on its own
 * channel, and the MCF fee still lands under Amazon's fees. With Amazon the only channel, the
 * MCF orders' units count here (from the Orders tab, priced from Amazon's queue) and are shown
 * as their own line — Amazon reports no money for them, so their cost and fee count with no sale
 * against them until the channel that sold them is connected.
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

/**
 * Where a unit is priced from: a channel's stock — "AMAZON" | "SHOPIFY" | "TIKTOK", what was
 * shipped to that channel — or one of the company's own facilities, by id. Null = the order is
 * placed at no facility, so nothing can price it.
 */
type QueueKey = string;
/** One sale to price: units of a product on a channel at an instant (null = not posted yet — goes last), from a queue. */
/** `mcf`: an MCF order counted while Amazon is the only channel. `unreported`: an Amazon order
 *  that shipped but Amazon posted no money for (a free unit, a replacement) — units from the
 *  Orders tab. Both are reported as their own lines under cost of goods. */
type Sale = { productId: string; units: number; at: number | null; channel: PnlChannel; queue: QueueKey | null; mcf?: boolean; unreported?: boolean };
type Cogs = {
  cogs: number;
  units: number;
  preHistoryUnits: number;
  overflowUnits: number;
  unplacedUnits: number;
  mcfUnits: number;
  mcfCogs: number;
  unreportedUnits: number;
  unreportedCogs: number;
  unmatchedSkus: Set<string>;
};
type Layer = { units: number; unitCost: number; date: number };

/** The queues: every place a unit can leave from, each holding its products' layers oldest first. */
async function loadQueues(): Promise<Map<QueueKey, Map<string, Layer[]>>> {
  const { shipped, entries } = await computeFinishedGoods();
  const queues = new Map<QueueKey, Map<string, Layer[]>>();
  const push = (queue: QueueKey, productId: string, l: Layer) => {
    if (l.units <= 0) return;
    const q = queues.get(queue) ?? new Map<string, Layer[]>();
    const list = q.get(productId) ?? [];
    list.push(l);
    q.set(productId, list);
    queues.set(queue, q);
  };
  // `sku` on both is the product id.
  for (const l of shipped) push(l.destination, l.sku, { units: l.units, unitCost: l.unitCost, date: l.date });
  for (const e of entries) push(e.facilityId, e.sku, { units: e.units, unitCost: e.unitCost, date: e.date });
  for (const q of queues.values()) for (const list of q.values()) list.sort((a, b) => a.date - b.date);
  return queues;
}

/**
 * Cost of goods, first-in-first-out from one queue of units per product per place.
 *
 * Every sale on record, from every channel, is replayed in date order from the very first one,
 * each taking units from the front of its place's queue; the walk always starts at the beginning
 * so that by the time it reaches the window it knows exactly which units were already gone.
 * Units that left a facility for somewhere else (a shipment to Amazon, a transfer, a write-off)
 * take from its queue in the same order but are never charged. The window's COGS is what the
 * selected channels' sales consumed there. Pending sales (not posted yet) join the end.
 *
 * Sales before a place's first recorded layer are pre-history (day-zero stock can't be eaten by
 * sales that predate it): they're priced at the product's pre-consl average cost (set from the
 * P&L; the starting cost, then the oldest layer, stand in until then) and counted in
 * `preHistoryUnits`. Sales beyond everything recorded take the newest layer's cost and count in
 * `overflowUnits` — never silently zero. Sales from an order placed nowhere count in
 * `unplacedUnits` and carry no cost.
 */
async function fifoCogs(sales: Sale[], from: Date, to: Date, selected: Set<PnlChannel>, scope: Scope): Promise<Cogs> {
  const queues = await loadQueues();
  const exits = await prisma.stockMovement.findMany({
    where: { itemType: "FINISHED", kind: "STANDARD", fromFacilityId: { not: null }, productId: { not: null } },
    select: { productId: true, fromFacilityId: true, quantity: true, date: true },
  });
  type Draw = { queue: QueueKey | null; productId: string; units: number; at: number | null; sale: Sale | null };
  const draws: Draw[] = [
    ...exits.map((e) => ({ queue: e.fromFacilityId as string, productId: e.productId as string, units: e.quantity, at: e.date.getTime(), sale: null })),
    ...sales.map((s) => ({ queue: s.queue, productId: s.productId, units: s.units, at: s.at, sale: s })),
  ];
  const order = (d: Draw) => d.at ?? Number.MAX_SAFE_INTEGER;
  draws.sort((a, b) => order(a) - order(b));

  const cursor = new Map<string, { idx: number; left: number }>(); // "queue|product"
  const out: Cogs = { cogs: 0, units: 0, preHistoryUnits: 0, overflowUnits: 0, unplacedUnits: 0, mcfUnits: 0, mcfCogs: 0, unreportedUnits: 0, unreportedCogs: 0, unmatchedSkus: new Set() };
  for (const d of draws) {
    const product = scope.byId.get(d.productId);
    if (!product) continue;
    const qty = d.units;
    const at = d.at;
    const sale = d.sale;
    const inWindow = !!sale && selected.has(sale.channel) && (at == null || (at >= from.getTime() && at <= to.getTime()));
    if (d.queue == null) {
      if (inWindow) out.unplacedUnits += qty;
      continue;
    }
    const layers = queues.get(d.queue)?.get(product.id) ?? [];
    const preConsl = product.preConslUnitCost ?? product.openingUnitCost ?? layers[0]?.unitCost ?? null;
    let cost = 0; // what this draw is charged, as a positive number
    // Pre-history: nothing recorded had entered the place yet, so nothing is consumed.
    const preHistory = at != null && layers.length > 0 && at < layers[0].date;
    if (layers.length === 0 || preHistory) {
      if (!inWindow) continue;
      if (preConsl == null) out.unmatchedSkus.add(product.code);
      else {
        cost = qty * preConsl;
        out.preHistoryUnits += qty;
      }
    } else {
      const ck = `${d.queue}|${product.id}`;
      const c = cursor.get(ck) ?? { idx: 0, left: layers[0].units };
      let want = qty;
      while (want > 1e-9 && c.idx < layers.length) {
        const take = Math.min(c.left, want);
        if (inWindow) cost += take * layers[c.idx].unitCost;
        c.left -= take;
        want -= take;
        if (c.left <= 1e-9) {
          c.idx++;
          c.left = c.idx < layers.length ? layers[c.idx].units : 0;
        }
      }
      cursor.set(ck, c);
      if (!inWindow) continue;
      if (want > 1e-9) {
        // Sold more than was ever recorded entering the place — most likely the newest shipment
        // wasn't recorded, so the rest carries the newest cost on record.
        const newest = layers[layers.length - 1]?.unitCost ?? preConsl;
        if (newest == null) out.unmatchedSkus.add(product.code);
        else {
          cost += want * newest;
          out.overflowUnits += want;
        }
      }
    }
    out.units += qty;
    out.cogs -= cost;
    if (sale?.mcf) {
      out.mcfUnits += qty;
      out.mcfCogs -= cost;
    }
    if (sale?.unreported) {
      out.unreportedUnits += qty;
      out.unreportedCogs -= cost;
    }
  }
  return out;
}

type Bridge = {
  sales: { type: string; amount: number }[];
  taxes: number;
  fba: number;
  referral: number;
  /** Units per SKU, with the facility the order was fulfilled from, for the FIFO walk to price. */
  lines: { sku: string; units: number; facility: string | null }[];
  pendingSales: number;
};

/** Orders in range whose shipment money hasn't posted yet → exact revenue + estimated fees. */
async function pendingBridge(from: Date, to: Date, scope: Set<string>, baseCurrency: string): Promise<Bridge> {
  const none: Bridge = { sales: [], taxes: 0, fba: 0, referral: 0, lines: [], pendingSales: 0 };
  const orgId = await getCurrentOrgId();
  if (!orgId) return none;

  const candidates = await prisma.$queryRaw<
    { id: string; total: number; currency: string; orderedAt: Date; productGross: number | null; discounts: number | null; tax: number | null; shipping: number | null; giftWrap: number | null; facility: string | null }[]
  >`
    SELECT so.id, so.total, so.currency, so."orderedAt", so."productGross", so.discounts, so.tax, so.shipping, so."giftWrap",
      COALESCE(so."fulfillmentOverrideFacilityId", so."fulfillmentFacilityId") AS facility
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
  const facilityOf = new Map(orders.map((o) => [o.id, o.facility]));

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
  const pendingLines: { sku: string; units: number; facility: string | null }[] = [];
  for (const l of lines) {
    const sku = l.sku ?? "";
    const fx = rateOf.get(l.orderId) ?? 1;
    const hist = principalBySku.get(sku);
    const fbaPerUnit = hist && hist.units > 0 ? (fbaBySku.get(sku) ?? 0) / hist.units : orgFbaPerUnit;
    const commissionRate = hist && hist.amount > 0 ? (commissionBySku.get(sku) ?? 0) / hist.amount : orgCommissionRate;
    const gross = (l.gross || l.quantity * l.unitPrice) * fx;
    fba += l.quantity * fbaPerUnit;
    referral += gross * commissionRate;
    pendingLines.push({ sku, units: l.quantity, facility: facilityOf.get(l.orderId) ?? null });
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
  unmatchedSkus: [], preHistoryUnits: 0, overflowUnits: 0, unplacedUnits: 0, mcf: { units: 0, cogs: 0 }, unreported: { units: 0, cogs: 0 }, ignored: { skus: [], units: 0, sales: 0 }, backfillInProgress: false, importProgress: null, hasData: false,
};

/** The statement for a window, over the given channels (default: every channel with data). */
export async function getPnl(from: Date, to: Date, channels?: PnlChannel[]): Promise<Pnl> {
  const orgId = await getCurrentOrgId();
  const present = await presentPnlChannels();
  const selected = (channels ?? present).filter((c) => present.includes(c));
  const selectedSet = new Set(selected);
  if (!orgId || selected.length === 0) return EMPTY;
  const [scope, org, exclusions, facilities] = await Promise.all([loadScope(), getCurrentOrg(), activeExclusions(), prisma.facility.findMany({ select: { id: true, channel: true } })]);
  // The queue an order's facility prices from: a channel facility is that channel's stock
  // (Amazon FBA and AWD share Amazon's), one of the company's own places is its own queue.
  const facilityChannel = new Map(facilities.map((f) => [f.id, f.channel]));
  const queueOf = (facilityId: string | null): QueueKey | null => {
    if (!facilityId || !facilityChannel.has(facilityId)) return null;
    const ch = facilityChannel.get(facilityId);
    return ch ? (ch.startsWith("AMAZON") ? "AMAZON" : ch) : facilityId;
  };
  const baseCurrency = org?.currencyCode ?? "USD";
  const excludedSources = exclusions.sources;
  const amazonSkus = [...scope.amazon.keys()];
  const tiktokSkus = [...scope.tiktok.keys()];
  const lineChannels = selected.filter((c) => c !== "AMAZON");

  // The ledgers, by bucket. Amazon and TikTok rows are scoped by the SKU they name; Shopify rows
  // exist only for managed lines. A voided order does not exist — on any channel, its money rows
  // are skipped by their order number — and a Shopify order the Orders tab drops as another
  // channel's mirror is dropped here too.
  const sums = await prisma.$queryRaw<{ group: string; type: string; amount: number }[]>`
    SELECT fe."group", fe."type", COALESCE(SUM(fe."baseAmount"), 0)::float8 AS amount
    FROM "FinanceEvent" fe
    WHERE fe."orgId" = ${orgId} AND fe.channel = ANY(${selected}::text[])
      AND fe."eventAt" >= ${from} AND fe."eventAt" <= ${to}
      AND (fe.sku IS NULL OR fe.channel = 'SHOPIFY'
        OR (fe.channel = 'AMAZON' AND fe.sku = ANY(${amazonSkus}::text[]))
        OR (fe.channel = 'TIKTOK' AND fe.sku = ANY(${tiktokSkus}::text[])))
      AND NOT EXISTS (
        SELECT 1 FROM "SalesOrder" so
        WHERE so."orgId" = fe."orgId" AND so.channel = fe.channel AND so."externalId" = fe."orderId"
          AND (so.voided OR (so.channel = 'SHOPIFY' AND so.source = ANY(${excludedSources}::text[]))))
    GROUP BY 1, 2`;
  const blocks = new Map<string, { type: string; amount: number }[]>();
  const add = (group: string, type: string, amount: number) => blocks.set(group, [...(blocks.get(group) ?? []), { type, amount }]);
  for (const s of sums) add(s.group, s.type, s.amount);

  // Custom fees the operator attached (by rule or by hand): a cost on the order's own channel. A
  // fee counts whenever its order counts; on an MCF order it always counts (the fee is a real
  // cost even though that order's revenue lives on another channel); on a Shopify order the
  // double-count rule drops, only a hand-written fee counts.
  const feeRows = await prisma.$queryRaw<{ name: string; bucket: string; currency: string; amount: number; orderedAt: Date }[]>`
    SELECT f.name, f.bucket, o.currency, f.amount::float8 AS amount, o."orderedAt"
    FROM "OrderFee" f JOIN "SalesOrder" o ON o.id = f."orderId"
    WHERE o."orgId" = ${orgId} AND o.channel = ANY(${selected}::text[])
      AND o."orderedAt" >= ${from} AND o."orderedAt" <= ${to}
      AND o.cancelled = false AND o.voided = false
      AND (f."ruleId" IS NULL OR o.mcf OR NOT (o.channel = 'SHOPIFY' AND o.source = ANY(${excludedSources}::text[])))`;
  // Each fee lands in the bucket its rule chose — a processor's charge under Payment processing,
  // everything else under Custom fees — as its own line.
  const feeByName = new Map<string, { bucket: string; name: string; amount: number }>();
  for (const f of feeRows) {
    const fx = f.currency === baseCurrency ? 1 : await fxRate(f.currency, baseCurrency, f.orderedAt);
    const bucket = f.bucket === "payment_fees" ? "payment_fees" : "custom_fees";
    const k = `${bucket}|${f.name}`;
    feeByName.set(k, { bucket, name: f.name, amount: (feeByName.get(k)?.amount ?? 0) - f.amount * fx });
  }
  for (const f of feeByName.values()) add(f.bucket, f.name, f.amount);

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
      if (p) pendingSales.push({ productId: p.id, units: l.units, at: null, channel: "AMAZON", queue: queueOf(l.facility) });
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

  // Every sale on record, from every channel — the FIFO walk needs all of history. Each carries
  // the queue of the facility its order shipped from; an order placed nowhere carries none.
  // Amazon's sale rows don't say where they shipped from, so each is looked up on its order (a
  // voided order's rows are skipped); a row with no order record on file is Amazon's when Amazon
  // charged an FBA fee for that order.
  const amazonRows = await prisma.$queryRaw<{ sku: string; units: number; at: Date; facility: string | null; placed: boolean; fbaFee: boolean }[]>`
    SELECT fe.sku, fe.quantity::int AS units, fe."eventAt" AS at,
      COALESCE(so."fulfillmentOverrideFacilityId", so."fulfillmentFacilityId") AS facility,
      (so.id IS NOT NULL) AS placed,
      CASE WHEN so.id IS NULL THEN EXISTS (
        SELECT 1 FROM "FinanceEvent" f2
        WHERE f2."orgId" = fe."orgId" AND f2.channel = 'AMAZON' AND f2."orderId" = fe."orderId" AND f2.type LIKE 'FBA%')
      ELSE false END AS "fbaFee"
    FROM "FinanceEvent" fe
    LEFT JOIN "SalesOrder" so ON so."orgId" = fe."orgId" AND so.channel = 'AMAZON' AND so."externalId" = fe."orderId"
    WHERE fe."orgId" = ${orgId} AND fe.channel = 'AMAZON' AND fe."group" = 'sales' AND fe.type = 'Principal'
      AND fe.quantity IS NOT NULL AND fe.sku = ANY(${amazonSkus}::text[])
      AND (so.id IS NULL OR so.voided = false)
    ORDER BY fe."eventAt" ASC, fe.id ASC`;
  const sales: Sale[] = [];
  for (const r of amazonRows) {
    const p = scope.amazon.get(r.sku);
    if (!p) continue;
    const queue = r.placed ? queueOf(r.facility) : r.fbaFee ? "AMAZON" : null;
    sales.push({ productId: p.id, units: r.units, at: r.at.getTime(), channel: "AMAZON", queue });
  }
  const lineRows = await prisma.$queryRaw<{ channel: string; productId: string; units: number; at: Date; facility: string | null }[]>`
    SELECT o.channel, l."productId", l.quantity::int AS units, o."orderedAt" AS at,
      COALESCE(o."fulfillmentOverrideFacilityId", o."fulfillmentFacilityId") AS facility
    FROM "SalesOrderLine" l JOIN "SalesOrder" o ON o.id = l."orderId"
    WHERE o."orgId" = ${orgId} AND o.channel IN ('SHOPIFY', 'TIKTOK') AND l."productId" IS NOT NULL
      AND o.cancelled = false AND o.voided = false
      AND NOT (o.channel = 'SHOPIFY' AND o.source = ANY(${excludedSources}::text[]))`;
  for (const r of lineRows) sales.push({ productId: r.productId, units: r.units, at: r.at.getTime(), channel: r.channel as PnlChannel, queue: queueOf(r.facility) });
  // Amazon orders that shipped but Amazon posted no money for — a free unit, a replacement: no
  // sale row, so nothing above saw the unit leave. Their units come from the Orders tab instead,
  // one source per order: an order with a sale row in the money report is never read here, and
  // the moment Amazon posts one this copy drops on its own. (An order with money that hasn't
  // posted yet is the pending bridge's, not this.)
  const unreportedRows = await prisma.$queryRaw<{ productId: string; units: number; at: Date; facility: string | null }[]>`
    SELECT l."productId", l.quantity::int AS units, o."orderedAt" AS at,
      COALESCE(o."fulfillmentOverrideFacilityId", o."fulfillmentFacilityId") AS facility
    FROM "SalesOrderLine" l JOIN "SalesOrder" o ON o.id = l."orderId"
    WHERE o."orgId" = ${orgId} AND o.channel = 'AMAZON' AND o.mcf = false AND l."productId" IS NOT NULL
      AND o.cancelled = false AND o.voided = false AND o.total = 0
      AND o.status IN ('Shipped', 'PartiallyShipped')
      AND NOT EXISTS (
        SELECT 1 FROM "FinanceEvent" fe
        WHERE fe."orgId" = o."orgId" AND fe.channel = 'AMAZON' AND fe."orderId" = o."externalId" AND fe.type = 'Principal')`;
  for (const r of unreportedRows) sales.push({ productId: r.productId, units: r.units, at: r.at.getTime(), channel: "AMAZON", queue: queueOf(r.facility), unreported: true });
  // Amazon the only channel: the MCF orders' units count too, from the Orders tab, as their own line.
  if (!exclusions.mcf) {
    const mcfRows = await prisma.$queryRaw<{ productId: string; units: number; at: Date; facility: string | null }[]>`
      SELECT l."productId", l.quantity::int AS units, o."orderedAt" AS at,
        COALESCE(o."fulfillmentOverrideFacilityId", o."fulfillmentFacilityId") AS facility
      FROM "SalesOrderLine" l JOIN "SalesOrder" o ON o.id = l."orderId"
      WHERE o."orgId" = ${orgId} AND o.channel = 'AMAZON' AND o.mcf = true AND l."productId" IS NOT NULL
        AND o.cancelled = false AND o.voided = false`;
    for (const r of mcfRows) sales.push({ productId: r.productId, units: r.units, at: r.at.getTime(), channel: "AMAZON", queue: queueOf(r.facility), mcf: true });
  }

  const fifo = await fifoCogs([...sales, ...pendingSales], from, to, selectedSet, scope);

  const groups: PnlGroupBlock[] = GROUP_ORDER.map((g) => {
    const types = (blocks.get(g) ?? []).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return { group: g, total: types.reduce((t, r) => t + r.amount, 0), types };
  }).filter((b) => b.types.length > 0);

  const salesTotal = groups.find((g) => g.group === "sales")?.total ?? 0;
  const ledgerTotal = groups.reduce((t, g) => t + g.total, 0);
  const netProfit = ledgerTotal + fifo.cogs;

  const [settings, amazonConnected] = await Promise.all([
    prisma.settings.findFirst({ select: { financeBackfillCursor: true, financeRewalkCursor: true, financeProgressAt: true, importerVersions: true } }),
    prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" }, select: { id: true } }),
  ]);
  const importProgress = selectedSet.has("AMAZON") && amazonConnected ? amazonImportProgress(settings) : null;

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
    unplacedUnits: fifo.unplacedUnits,
    mcf: { units: fifo.mcfUnits, cogs: fifo.mcfCogs },
    unreported: { units: fifo.unreportedUnits, cogs: fifo.unreportedCogs },
    ignored,
    backfillInProgress: importProgress !== null,
    importProgress,
    hasData: groups.length > 0 || fifo.units > 0,
  };
}

/**
 * Where the Amazon ledger walks stand. Two can run, one after the other: the first history import
 * (walks back from today to Amazon's two-year floor) and, whenever the code's importer generation
 * is newer than the one that wrote this ledger, a re-read over the same span. Both walk backwards
 * a week per minute, so "reached" is the day they are at and the percentage is how much of the
 * span is behind them. A walk whose last window completed over half an hour ago has stalled —
 * the scheduler retries every minute, but the notice says so instead of pretending.
 */
export function amazonImportProgress(
  s: { financeBackfillCursor: string | null; financeRewalkCursor: string | null; financeProgressAt: Date | null; importerVersions: unknown } | null,
): Pnl["importProgress"] {
  const now = Date.now();
  const floor = now - 725 * 86_400_000;
  const backfillDone = !!s?.financeBackfillCursor && new Date(s.financeBackfillCursor).getTime() <= floor;
  const rereadDue = importerVersion(s?.importerVersions, "amazonFinance") < IMPORTER_VERSIONS.amazonFinance;
  let phase: "history" | "reread";
  let reachedAt: number;
  if (!backfillDone) {
    phase = "history";
    reachedAt = s?.financeBackfillCursor ? new Date(s.financeBackfillCursor).getTime() : now;
  } else if (rereadDue) {
    phase = "reread";
    reachedAt = s?.financeRewalkCursor ? new Date(s.financeRewalkCursor).getTime() : now;
  } else return null;
  const percent = Math.max(0, Math.min(100, Math.round(((now - reachedAt) / (now - floor)) * 100)));
  const stalled = !!s?.financeProgressAt && now - s.financeProgressAt.getTime() > 30 * 60_000;
  return { phase, reached: new Date(reachedAt).toISOString().slice(0, 10), percent, stalled };
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
