import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { getOrgSettings } from "@/lib/settings";

/**
 * Read side of the orders feed. The dedup rule lives HERE, not in the importer: a Shopify order
 * whose originating channel is on the org's exclusion list is dropped from Shopify totals, so a
 * mirrored order (TikTok selling through Shopify) is counted once — on the TikTok side once that
 * shop is connected. Applying it at read time keeps the toggle instant and reversible.
 *
 * The summary is aggregated in SQL (scales to a full multi-year history); the table is a paged
 * skip/take query. Revenue is summed from LINE prices, not SalesOrder.total: channel-mirrored
 * orders record a $0 order total in Shopify while the line prices are the real (discounted) ones.
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
  cancelled: boolean;
  excluded: boolean;
};

export type ChannelSummary = { channel: string; label: string; orders: number; units: number; revenue: number };
export type SourceToggle = { source: string; label: string; count: number; excluded: boolean };

export type OrdersSummary = {
  channels: ChannelSummary[];
  totalOrders: number;
  totalUnits: number;
  totalRevenue: number;
  currency: string;
  sources: SourceToggle[];
};

export type OrdersPage = { rows: OrderRow[]; total: number; page: number; pageSize: number; pageCount: number };

/** Channel totals + the exclusion toggles, aggregated in SQL so it scales to full history. */
export async function getOrdersSummary(connectedChannels: string[] = []): Promise<OrdersSummary> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return { channels: [], totalOrders: 0, totalUnits: 0, totalRevenue: 0, currency: "USD", sources: [] };
  const settings = await getOrgSettings();
  const excluded = settings.excludedShopifySources ?? [];
  const connected = new Set(connectedChannels);

  // Per-channel counted totals (drop cancelled + excluded Shopify sources).
  const rows = await prisma.$queryRaw<
    { channel: string; orders: bigint; units: bigint | null; revenue: number | null }[]
  >`
    SELECT o.channel,
           COUNT(DISTINCT o.id) AS orders,
           SUM(l.quantity) AS units,
           SUM(l.quantity * l."unitPrice") AS revenue
    FROM "SalesOrder" o
    JOIN "SalesOrderLine" l ON l."orderId" = o.id
    WHERE o."orgId" = ${orgId}
      AND o.cancelled = false
      AND NOT (o.channel = 'SHOPIFY' AND o.source = ANY(${excluded}))
    GROUP BY o.channel
    ORDER BY revenue DESC NULLS LAST`;

  const channels: ChannelSummary[] = rows.map((r) => ({
    channel: r.channel,
    label: CHANNEL_LABEL[r.channel] ?? r.channel,
    orders: Number(r.orders),
    units: Number(r.units ?? 0),
    revenue: Number(r.revenue ?? 0),
  }));

  // Distinct mirrored Shopify sources whose channel is connected → exclusion toggles.
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

  return {
    channels,
    totalOrders: channels.reduce((s, c) => s + c.orders, 0),
    totalUnits: channels.reduce((s, c) => s + c.units, 0),
    totalRevenue: channels.reduce((s, c) => s + c.revenue, 0),
    currency: "USD",
    sources,
  };
}

/** One page of orders, newest first. Excluded/cancelled orders still show (dimmed) for transparency. */
export async function getOrdersPage(page = 1, pageSize = 50): Promise<OrdersPage> {
  const settings = await getOrgSettings();
  const excluded = new Set(settings.excludedShopifySources ?? []);

  const total = await prisma.salesOrder.count();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);

  const orders = await prisma.salesOrder.findMany({
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
      currency: true,
      cancelled: true,
      lines: { select: { quantity: true, unitPrice: true } },
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
    total: o.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
    currency: o.currency,
    cancelled: o.cancelled,
    excluded: o.channel === "SHOPIFY" && !!o.source && excluded.has(o.source),
  }));

  return { rows, total, page: current, pageSize, pageCount };
}
