import "server-only";
import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { getCurrentOrgId } from "@/lib/tenant";
import { getCurrentOrg } from "@/lib/org";
import { fxRate } from "@/lib/fx";
import { getPnlHistory } from "@/lib/pnl";
import { pnlFingerprint } from "@/lib/pnl-cache";
import { activeExclusions } from "@/lib/order-metrics";
import { hasShopifyCustomerScope } from "@/lib/orders";
import { encodeLtvOrders, isWholesaleSource, type LtvOrder, type LtvWire } from "@/lib/ltv";

/**
 * The lifetime-value report for the company in context — Shopify first (the one channel that says
 * who bought; Amazon never does).
 *
 * Every figure is the P&L's own, order by order: an order's REVENUE is its money rows on the
 * Shopify statement (sales and shipping, tax in and out cancelling, refunds and chargebacks
 * whenever they came), its PROFIT takes off its fees (processing, custom) and what its units
 * really cost — priced by the statement's own FIFO walk (getPnlHistory's per-order hook), so the
 * two screens cannot disagree. The same orders count as on the P&L: not cancelled, not voided,
 * not another channel's mirror — and, here only, not a wholesale marketplace's (Faire): a retailer
 * buying to resell is not a consumer. Ad spend is the Shopify statement's Advertising bucket, by
 * month. The orders go to the browser compact; the page builds every view from them itself.
 */
export type LtvPayload = {
  channel: "SHOPIFY";
  /** Whether this store's connection may read who the customer is. Without it there is nothing to group by. */
  customerAccess: boolean;
  connected: boolean;
  /** Orders that count on the statement but carry no customer (a connection without the permission, or a sale made with no customer on file). */
  ordersWithoutCustomer: number;
  /** Wholesale marketplace orders left out of this page (they stay on the P&L), and where from. */
  wholesale: { orders: number; sources: string[] };
  wire: LtvWire;
  adSpendByMonth: Record<string, number>;
  /** Company-calendar bounds for the date picker: today, and the first order on this page. */
  newest: string;
  oldest: string;
  computedAt: string;
};

const dayIn = (tz: string) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return (at: Date) => f.format(at);
};

export async function computeLtv(tz: string): Promise<LtvPayload> {
  const [conn, exclusions, org] = await Promise.all([
    prisma.integration.findFirst({ where: { provider: "shopify" }, select: { status: true, scope: true } }),
    activeExclusions(),
    getCurrentOrg(),
  ]);
  const baseCurrency = org?.currencyCode ?? "USD";
  const dayOf = dayIn(tz);

  const orders = await prisma.salesOrder.findMany({
    where: { channel: "SHOPIFY", cancelled: false, voided: false, NOT: { source: { in: exclusions.sources } } },
    select: {
      id: true, externalId: true, customerId: true, orderedAt: true, currency: true, source: true, sourceLabel: true,
      lines: { select: { quantity: true, unitPrice: true, gross: true, sku: true, product: { select: { name: true, code: true } } } },
      fees: { select: { amount: true } },
    },
    orderBy: { orderedAt: "asc" },
  });

  // Each order's money rows on the Shopify statement, by bucket.
  const money = await prisma.$queryRaw<{ orderId: string; group: string; amount: number }[]>`
    SELECT fe."orderId", fe."group", COALESCE(SUM(fe."baseAmount"), 0)::float8 AS amount
    FROM "FinanceEvent" fe
    WHERE fe.channel = 'SHOPIFY' AND fe."orderId" IS NOT NULL
    GROUP BY 1, 2`;
  const byOrder = new Map<string, { revenue: number; costs: number }>();
  for (const r of money) {
    const m = byOrder.get(r.orderId) ?? { revenue: 0, costs: 0 };
    // Tax collected (sales) and tax remitted (taxes) cancel; refunds and chargebacks come off revenue.
    if (r.group === "sales" || r.group === "taxes" || r.group === "refunds") m.revenue += r.amount;
    else if (r.group !== "advertising") m.costs += r.amount;
    byOrder.set(r.orderId, m);
  }

  // What each order's units cost, from the statement's own FIFO walk.
  const cogs = new Map<string, number>();
  await getPnlHistory(tz, { onOrderCost: (orderId, cost) => cogs.set(orderId, (cogs.get(orderId) ?? 0) + cost) });

  const ltvOrders: LtvOrder[] = [];
  let ordersWithoutCustomer = 0;
  const wholesale = { orders: 0, sources: new Set<string>() };
  for (const o of orders) {
    if (isWholesaleSource(o.source)) {
      wholesale.orders++;
      wholesale.sources.add(o.sourceLabel || o.source || "Wholesale");
      continue;
    }
    if (!o.customerId) {
      ordersWithoutCustomer++;
      continue;
    }
    const m = byOrder.get(o.externalId) ?? { revenue: 0, costs: 0 };
    const fx = o.currency === baseCurrency ? 1 : await fxRate(o.currency, baseCurrency, o.orderedAt);
    const customFees = o.fees.reduce((t, f) => t + f.amount, 0) * fx;
    const top = [...o.lines].sort((a, b) => (b.gross || b.quantity * b.unitPrice) - (a.gross || a.quantity * a.unitPrice))[0];
    ltvOrders.push({
      customerId: o.customerId,
      at: o.orderedAt.getTime(),
      day: dayOf(o.orderedAt),
      revenue: Math.round(m.revenue * 100) / 100,
      profit: Math.round((m.revenue + m.costs - customFees + (cogs.get(o.id) ?? 0)) * 100) / 100,
      product: top?.product?.name ?? top?.sku ?? null,
    });
  }

  const ads = await prisma.$queryRaw<{ month: string; spend: number }[]>`
    SELECT to_char((fe."eventAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}), 'YYYY-MM') AS month, COALESCE(SUM(-fe."baseAmount"), 0)::float8 AS spend
    FROM "FinanceEvent" fe
    WHERE fe.channel = 'SHOPIFY' AND fe."group" = 'advertising'
    GROUP BY 1`;

  const today = dayOf(new Date());
  return {
    channel: "SHOPIFY",
    customerAccess: hasShopifyCustomerScope(conn?.scope),
    connected: conn?.status === "connected",
    ordersWithoutCustomer,
    wholesale: { orders: wholesale.orders, sources: [...wholesale.sources].sort() },
    wire: encodeLtvOrders(ltvOrders),
    adSpendByMonth: Object.fromEntries(ads.map((a) => [a.month, Math.round(a.spend * 100) / 100])),
    newest: today,
    oldest: ltvOrders.length ? ltvOrders.reduce((d, o) => (o.day < d ? o.day : d), today) : today,
    computedAt: new Date().toISOString(),
  };
}

/** The stored report while nothing underneath changed and the company's day hasn't (ages move with
 *  the date), else computed again and stored. Any trouble storing falls back to computing. */
export async function loadLtv(tz: string): Promise<LtvPayload> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return computeLtv(tz);
  try {
    const fingerprint = `${await pnlFingerprint(orgId, tz)}:${dayIn(tz)(new Date())}:ltv2`;
    const stored = await prismaBase.ltvSnapshot.findUnique({ where: { orgId } });
    if (stored?.fingerprint === fingerprint) return stored.payload as unknown as LtvPayload;
    const t0 = Date.now();
    const payload = await computeLtv(tz);
    const data = { fingerprint, payload: payload as unknown as object, computedAt: new Date(), durationMs: Date.now() - t0 };
    await prismaBase.ltvSnapshot.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
    return payload;
  } catch (e) {
    console.warn("[ltv] snapshot unavailable, computing directly:", (e as Error).message);
    return computeLtv(tz);
  }
}
