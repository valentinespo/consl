import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { getOrgSettings } from "@/lib/settings";

/**
 * Read side of the orders feed.
 *
 * The dedup rule lives HERE, not in the importer: a Shopify order whose originating channel is on
 * the org's exclusion list is dropped from totals, so a mirrored order (TikTok selling through
 * Shopify) is counted once. Applied at read time so the toggle is instant and reversible.
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

// Shopify `source` keyword → the consl channel it mirrors. Only offered as an exclusion toggle when
// that channel is actually connected (never the merchant's own store, never a channel we don't pull
// elsewhere like Faire wholesale — excluding those would just drop the sales).
const MIRROR_TO_CHANNEL: Record<string, string> = { tiktok: "TIKTOK", amazon: "AMAZON" };
const CHANNEL_LABEL_FROM_KEY: Record<string, string> = { TIKTOK: "TikTok", AMAZON: "Amazon" };

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
  /** Out of every total (auto rules or manual pin) — washed out with the Voided pill. */
  voided: boolean;
  excluded: boolean;
};

export type ChannelSummary = { channel: string; label: string; orders: number; units: number; revenue: number };
export type SourceToggle = { source: string; label: string; count: number; excluded: boolean };
/** The Amazon-MCF exclusion toggle — offered once a non-Amazon channel is connected, since the
 *  same sale then counts on that channel's own order too. */
export type McfToggle = { offered: boolean; count: number; excluded: boolean };

export type OrdersSummary = {
  channels: ChannelSummary[];
  totalOrders: number;
  totalUnits: number;
  totalRevenue: number;
  currency: string;
  sources: SourceToggle[];
  mcf: McfToggle;
};

export type OrdersPage = { rows: OrderRow[]; total: number; page: number; pageSize: number; pageCount: number };

/** Channel totals + the exclusion toggles, aggregated in SQL so it scales to full history. */
export async function getOrdersSummary(connectedChannels: string[] = [], filter: OrdersFilter = {}): Promise<OrdersSummary> {
  const orgId = await getCurrentOrgId();
  if (!orgId) {
    return {
      channels: [],
      totalOrders: 0,
      totalUnits: 0,
      totalRevenue: 0,
      currency: "USD",
      sources: [],
      mcf: { offered: false, count: 0, excluded: false },
    };
  }
  const settings = await getOrgSettings();
  const excluded = settings.excludedShopifySources ?? [];
  const excludeMcf = settings.excludeMcfOrders ?? false;
  const connected = new Set(connectedChannels);
  const { since, until } = bounds(filter);
  const channelFilter = filter.channel ?? null;

  // Two aggregations: revenue/orders straight off SalesOrder (joining lines would multiply an
  // order's total once per line), units from a joined pass.
  const rows = await prisma.$queryRaw<{ channel: string; orders: bigint; revenue: number | null }[]>`
    SELECT o.channel, COUNT(*) AS orders, SUM(o.total) AS revenue
    FROM "SalesOrder" o
    WHERE o."orgId" = ${orgId}
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

  // Distinct mirrored Shopify sources whose channel is connected → exclusion toggles (always global,
  // so the toggle doesn't vanish when a filter hides Shopify).
  const srcRows = await prisma.$queryRaw<{ source: string; count: bigint }[]>`
    SELECT o.source, COUNT(*) AS count
    FROM "SalesOrder" o
    WHERE o."orgId" = ${orgId} AND o.channel = 'SHOPIFY' AND o.source IS NOT NULL
    GROUP BY o.source`;
  const sources: SourceToggle[] = srcRows
    .map((r) => ({ source: r.source, ch: mirrorChannel(r.source), count: Number(r.count) }))
    .filter((r) => r.ch && connected.has(r.ch))
    .map((r) => ({ source: r.source, label: CHANNEL_LABEL_FROM_KEY[r.ch!] ?? r.ch!, count: r.count, excluded: excluded.includes(r.source) }))
    .sort((a, b) => b.count - a.count);

  // The mirror in the other direction: Amazon MCF rows are Amazon shipping another channel's
  // sale. Offered (global count, like the source toggles) once any non-Amazon channel is
  // connected — before that, the MCF rows are the only trace of those sales, so dropping them
  // would just lose orders. Cancelled MCF rows are left out of the count: they were never in the
  // totals, so the number shown matches exactly what the toggle removes.
  const mcfCount = await prisma.salesOrder.count({ where: { channel: "AMAZON", mcf: true, voided: false } });
  const mcf: McfToggle = {
    offered: mcfCount > 0 && [...connected].some((c) => c !== "AMAZON"),
    count: mcfCount,
    excluded: excludeMcf,
  };

  return {
    channels,
    totalOrders: channels.reduce((s, c) => s + c.orders, 0),
    totalUnits: channels.reduce((s, c) => s + c.units, 0),
    totalRevenue: channels.reduce((s, c) => s + c.revenue, 0),
    currency: "USD",
    sources,
    mcf,
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
function searchWhere(raw: string): Record<string, unknown> {
  const q = raw.trim();
  const s = q.toLowerCase();
  const contains = (v: string) => ({ contains: v, mode: "insensitive" as const });

  if (["mcf", "multichannel", "multi-channel"].includes(s)) return { mcf: true };
  if (["replacement", "replacements"].includes(s)) return { replacement: true };
  if (["free", "free unit", "free units", "vine"].includes(s)) return FREE_UNIT_WHERE;
  if (["sample", "samples", "free sample", "free samples"].includes(s)) return FREE_SAMPLE_WHERE;
  if (["cancelled", "canceled"].includes(s)) return { cancelled: true };
  if (["voided", "void"].includes(s)) return { voided: true };
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
  const settings = await getOrgSettings();
  const excluded = new Set(settings.excludedShopifySources ?? []);
  const excludeMcf = settings.excludeMcfOrders ?? false;
  const { since, until } = bounds(filter);

  const q = filter.q?.trim();
  const where = {
    ...(filter.channel ? { channel: filter.channel } : {}),
    ...(since || until ? { orderedAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {}),
    ...(q ? { AND: [searchWhere(q)] } : {}),
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
    excluded: (o.channel === "SHOPIFY" && !!o.source && excluded.has(o.source)) || (excludeMcf && o.mcf),
  }));

  return { rows, total, page: current, pageSize, pageCount };
}
