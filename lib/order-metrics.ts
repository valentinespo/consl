import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";

/**
 * Read side of the orders feed.
 *
 * The dedup rule lives HERE, not in the importer, and it is automatic — never a setting. A Shopify
 * order created by a channel that is present in consl (connected, or with orders in the feed) is
 * that channel's sale and counts there; an Amazon MCF order is Amazon shipping another present
 * channel's sale. Both stay in the list, greyed out with the Voided pill. Applied at read time, so
 * connecting a channel (or loading its history) dedups the whole past at once.
 *
 * Money: `SalesOrder.total` is what the buyer actually PAID — shipping, taxes and discounts all
 * applied (a 100%-discounted sample order is $0). That is what the Total column and the revenue
 * tiles show. The per-SKU LINES carry net product revenue instead, for velocity/profit later.
 *
 * The summary aggregates in SQL (scales to a full multi-year history); the table is a paged
 * skip/take query. Both accept the same time/channel filters; the free-text search (order # or
 * amount) applies to the table only.
 */

const CHANNEL_LABEL: Record<string, string> = { AMAZON: "Amazon", SHOPIFY: "Shopify", TIKTOK: "TikTok" };

// Shopify `source` keyword → the consl channel it mirrors. Only a channel consl holds itself is a
// mirror (never the merchant's own store, never a channel we don't pull elsewhere like Faire
// wholesale — dropping those would just lose the sales).
const MIRROR_TO_CHANNEL: Record<string, string> = { tiktok: "TIKTOK", amazon: "AMAZON" };
const PROVIDER_CHANNEL: Record<string, string> = { amazon: "AMAZON", shopify: "SHOPIFY", tiktok: "TIKTOK" };

function mirrorChannel(source: string | null): string | null {
  if (!source) return null;
  const key = Object.keys(MIRROR_TO_CHANNEL).find((k) => source.toLowerCase().includes(k));
  return key ? MIRROR_TO_CHANNEL[key] : null;
}

export type OrdersFilter = {
  channel?: string; // AMAZON | SHOPIFY | TIKTOK
  from?: string; // ISO day (inclusive); undefined = beginning of time
  to?: string; // ISO day (inclusive); undefined = today
  q?: string; // free-text search — order #, amount, SKU, or words like "mcf" / "pending" / "free"
};

function bounds(f: OrdersFilter): { since: Date | null; until: Date | null } {
  return {
    since: f.from ? new Date(`${f.from}T00:00:00Z`) : null,
    until: f.to ? new Date(`${f.to}T23:59:59.999Z`) : null,
  };
}

export type OrderRow = {
  id: string;
  orderNumber: string | null;
  channel: string;
  channelLabel: string;
  sourceLabel: string | null;
  fulfillmentLabel: string | null;
  orderedAt: string;
  units: number;
  total: number;
  currency: string;
  status: string | null;
  cancelled: boolean;
  mcf: boolean;
  replacement: boolean;
  /** A shipped Amazon order that charged $0 and isn't MCF or a replacement — Vine or another freebie. */
  freeUnit: boolean;
  /** A TikTok order the buyer paid $0 for — a free sample. */
  freeSample: boolean;
  /** Manually voided from the row menu — out of every total, washed out with the Voided pill. */
  voided: boolean;
  /** Dropped by a double-count toggle (mirrored Shopify source / MCF) — same wash + Voided pill. */
  excluded: boolean;
};

export type ChannelSummary = { channel: string; label: string; orders: number; units: number; revenue: number };

export type OrdersSummary = {
  channels: ChannelSummary[];
  totalOrders: number;
  totalUnits: number;
  totalRevenue: number;
  currency: string;
};

/** What the double-count rule drops right now: the Shopify sources that mirror a present channel,
 *  and whether Amazon MCF orders are another present channel's sales. */
type Exclusions = { sources: string[]; mcf: boolean };

/** A channel is present once it is connected OR its orders are in the feed (a history load lands
 *  before the connection does). */
async function activeExclusions(alsoConnected: Iterable<string> = []): Promise<Exclusions> {
  const [connections, withOrders, shopifySources] = await Promise.all([
    prisma.integration.findMany({ where: { status: "connected" }, select: { provider: true } }),
    prisma.salesOrder.groupBy({ by: ["channel"] }),
    prisma.salesOrder.groupBy({ by: ["source"], where: { channel: "SHOPIFY", source: { not: null } } }),
  ]);
  const present = new Set([
    ...alsoConnected,
    ...connections.map((c) => PROVIDER_CHANNEL[c.provider]).filter(Boolean),
    ...withOrders.map((r) => r.channel),
  ]);
  const sources = shopifySources.map((r) => r.source as string).filter((s) => {
    const ch = mirrorChannel(s);
    return !!ch && present.has(ch);
  });
  return { sources, mcf: [...present].some((c) => c !== "AMAZON") };
}

export type OrdersPage = { rows: OrderRow[]; total: number; page: number; pageSize: number; pageCount: number };

/** Channel totals, aggregated in SQL so it scales to full history. */
export async function getOrdersSummary(connectedChannels: string[] = [], filter: OrdersFilter = {}): Promise<OrdersSummary> {
  const orgId = await getCurrentOrgId();
  if (!orgId) {
    return {
      channels: [],
      totalOrders: 0,
      totalUnits: 0,
      totalRevenue: 0,
      currency: "USD",
    };
  }
  const { sources: excluded, mcf: excludeMcf } = await activeExclusions(connectedChannels);
  const { since, until } = bounds(filter);
  const channelFilter = filter.channel ?? null;

  // Two aggregations: revenue/orders straight off SalesOrder (joining lines would multiply an
  // order's total once per line), units from a joined pass.
  const rows = await prisma.$queryRaw<{ channel: string; orders: bigint; revenue: number | null }[]>`
    SELECT o.channel, COUNT(*) AS orders, SUM(o.total) AS revenue
    FROM "SalesOrder" o
    WHERE o."orgId" = ${orgId}
      AND o.cancelled = false
      AND o.voided = false
      AND NOT (o.channel = 'SHOPIFY' AND o.source = ANY(${excluded}))
      AND NOT (${excludeMcf}::boolean AND o.mcf)
      AND (${since}::timestamp IS NULL OR o."orderedAt" >= ${since})
      AND (${until}::timestamp IS NULL OR o."orderedAt" <= ${until})
      AND (${channelFilter}::text IS NULL OR o.channel = ${channelFilter})
    GROUP BY o.channel`;
  const unitRows = await prisma.$queryRaw<{ channel: string; units: bigint | null }[]>`
    SELECT o.channel, SUM(l.quantity) AS units
    FROM "SalesOrder" o
    JOIN "SalesOrderLine" l ON l."orderId" = o.id
    WHERE o."orgId" = ${orgId}
      AND o.cancelled = false
      AND o.voided = false
      AND NOT (o.channel = 'SHOPIFY' AND o.source = ANY(${excluded}))
      AND NOT (${excludeMcf}::boolean AND o.mcf)
      AND (${since}::timestamp IS NULL OR o."orderedAt" >= ${since})
      AND (${until}::timestamp IS NULL OR o."orderedAt" <= ${until})
      AND (${channelFilter}::text IS NULL OR o.channel = ${channelFilter})
    GROUP BY o.channel`;
  const unitsByChannel = new Map(unitRows.map((r) => [r.channel, Number(r.units ?? 0)]));

  const channels: ChannelSummary[] = rows
    .map((r) => ({
      channel: r.channel,
      label: CHANNEL_LABEL[r.channel] ?? r.channel,
      orders: Number(r.orders),
      units: unitsByChannel.get(r.channel) ?? 0,
      revenue: Number(r.revenue ?? 0),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    channels,
    totalOrders: channels.reduce((s, c) => s + c.orders, 0),
    totalUnits: channels.reduce((s, c) => s + c.units, 0),
    totalRevenue: channels.reduce((s, c) => s + c.revenue, 0),
    currency: "USD",
  };
}

/** A shipped Amazon order that charged $0 without being MCF or a replacement — Vine or another freebie. */
const FREE_UNIT_WHERE = {
  channel: "AMAZON",
  total: 0,
  mcf: false,
  replacement: false,
  cancelled: false,
  OR: [{ status: "Shipped" }, { status: "PartiallyShipped" }],
};

/** A TikTok order the buyer paid $0 for — a creator or promo sample. */
const FREE_SAMPLE_WHERE = { channel: "TIKTOK", total: 0, cancelled: false };

/**
 * Free-text search → a where clause. Words people would actually type match what they mean:
 * "mcf" finds MCF orders, "pending"/"shipped"/"cancelled" match status, "free"/"vine" find
 * free units, a channel name filters that channel, a number matches the paid total, and anything
 * else sweeps order #, SKU, sales channel, fulfilled-at and status.
 */
function searchWhere(raw: string, ex: Exclusions): Record<string, unknown> {
  const q = raw.trim();
  const s = q.toLowerCase();
  const contains = (v: string) => ({ contains: v, mode: "insensitive" as const });

  if (["mcf", "multichannel", "multi-channel"].includes(s)) return { mcf: true };
  if (["replacement", "replacements"].includes(s)) return { replacement: true };
  if (["free", "free unit", "free units", "vine"].includes(s)) return FREE_UNIT_WHERE;
  if (["sample", "samples", "free sample", "free samples"].includes(s)) return FREE_SAMPLE_WHERE;
  if (["cancelled", "canceled"].includes(s)) return { cancelled: true };
  // "Voided" is what the row shows for a manual void AND for an order a double-count toggle drops,
  // so the word finds both — everything wearing the pill.
  if (["voided", "void", "excluded"].includes(s)) {
    return {
      OR: [
        { voided: true },
        ...(ex.sources.length ? [{ channel: "SHOPIFY", source: { in: ex.sources } }] : []),
        ...(ex.mcf ? [{ channel: "AMAZON", mcf: true }] : []),
      ],
    };
  }
  if (s === "pending") return { status: contains("pending") };
  if (s === "unshipped") return { status: contains("unshipped") };
  if (["shipped", "partially shipped"].includes(s)) return { OR: [{ status: "Shipped" }, { status: "PartiallyShipped" }] };
  if (["amazon", "shopify", "tiktok"].includes(s)) return { channel: s.toUpperCase() };
  if (["fba", "merchant"].includes(s)) return { fulfillmentLabel: contains(s) };

  const amount = /^[0-9]+([.,][0-9]{1,2})?$/.test(s) ? Number(s.replace(",", ".")) : null;
  return {
    OR: [
      { orderNumber: contains(q) },
      { sourceLabel: contains(q) },
      { fulfillmentLabel: contains(q) },
      { status: contains(q) },
      { lines: { some: { sku: contains(q) } } },
      // An amount searches the paid total within a cent, so "23.4" finds $23.40.
      ...(amount != null ? [{ total: { gte: amount - 0.005, lte: amount + 0.005 } }] : []),
    ],
  };
}

/** One page of orders, newest first, honouring the filters + search. Excluded/cancelled orders
 *  still show (dimmed) for transparency. */
export async function getOrdersPage(page = 1, pageSize = 50, filter: OrdersFilter = {}): Promise<OrdersPage> {
  const { sources: excluded, mcf: excludeMcf } = await activeExclusions();
  const { since, until } = bounds(filter);

  const q = filter.q?.trim();
  const where = {
    ...(filter.channel ? { channel: filter.channel } : {}),
    ...(since || until ? { orderedAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {}),
    ...(q ? { AND: [searchWhere(q, { sources: excluded, mcf: excludeMcf })] } : {}),
  };

  const total = await prisma.salesOrder.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);

  const orders = await prisma.salesOrder.findMany({
    where,
    orderBy: { orderedAt: "desc" },
    skip: (current - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      orderNumber: true,
      channel: true,
      source: true,
      sourceLabel: true,
      fulfillmentLabel: true,
      orderedAt: true,
      total: true,
      currency: true,
      status: true,
      cancelled: true,
      mcf: true,
      replacement: true,
      voided: true,
      lines: { select: { quantity: true } },
    },
  });

  const rows: OrderRow[] = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    channel: o.channel,
    channelLabel: CHANNEL_LABEL[o.channel] ?? o.channel,
    sourceLabel: o.sourceLabel,
    fulfillmentLabel: o.fulfillmentLabel,
    orderedAt: o.orderedAt.toISOString(),
    units: o.lines.reduce((s, l) => s + l.quantity, 0),
    total: o.total,
    currency: o.currency,
    status: o.status,
    cancelled: o.cancelled,
    mcf: o.mcf,
    replacement: o.replacement,
    freeUnit:
      o.channel === "AMAZON" &&
      o.total === 0 &&
      !o.mcf &&
      !o.replacement &&
      !o.cancelled &&
      (o.status === "Shipped" || o.status === "PartiallyShipped"),
    freeSample: o.channel === "TIKTOK" && o.total === 0 && !o.cancelled,
    voided: o.voided,
    excluded: (o.channel === "SHOPIFY" && !!o.source && excluded.includes(o.source)) || (excludeMcf && o.mcf),
  }));

  return { rows, total, page: current, pageSize, pageCount };
}
