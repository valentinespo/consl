import "server-only";
import { prisma } from "@/lib/prisma";
import { getOrgSettings } from "@/lib/settings";

/**
 * Read side of the orders feed. The dedup rule lives HERE, not in the importer: a Shopify order
 * whose originating channel is on the org's exclusion list is dropped from Shopify totals, so a
 * mirrored order (TikTok selling through Shopify) is counted once — on the TikTok side once that
 * shop is connected. Applying it at read time keeps the toggle instant and reversible.
 */

const CHANNEL_LABEL: Record<string, string> = { AMAZON: "Amazon", SHOPIFY: "Shopify", TIKTOK: "TikTok" };

// Shopify `source` keys that denote another sales channel consl ALSO pulls directly, so its orders
// would otherwise be counted twice. Maps the source keyword → the consl channel key. Only offered
// as an exclusion toggle when that channel is actually connected — excluding a channel we don't
// pull elsewhere (e.g. Faire wholesale) would just drop the sales, and the merchant's own store
// ("web", POS, subscriptions) is never offered at all.
const MIRROR_TO_CHANNEL: Record<string, string> = { tiktok: "TIKTOK", amazon: "AMAZON" };
const CHANNEL_LABEL_FROM_KEY: Record<string, string> = { TIKTOK: "TikTok", AMAZON: "Amazon" };

function mirrorChannel(source: string | null): string | null {
  if (!source) return null;
  const key = Object.keys(MIRROR_TO_CHANNEL).find((k) => source.toLowerCase().includes(k));
  return key ? MIRROR_TO_CHANNEL[key] : null;
}

export type OrderRow = {
  id: string;
  channel: string;
  channelLabel: string;
  sourceLabel: string | null;
  orderedAt: string;
  units: number;
  total: number;
  currency: string;
  cancelled: boolean;
  excluded: boolean; // dropped from totals by the exclusion rule (shown dimmed, for transparency)
};

export type ChannelSummary = { channel: string; label: string; orders: number; units: number; revenue: number };

export type SourceToggle = { source: string; label: string; count: number; excluded: boolean };

export type OrdersOverview = {
  channels: ChannelSummary[];
  totalOrders: number;
  totalUnits: number;
  totalRevenue: number;
  currency: string;
  sources: SourceToggle[]; // exclusion toggles for mirrored Shopify sources
  recent: OrderRow[];
};

export async function getOrdersOverview(connectedChannels: string[] = [], recentLimit = 60): Promise<OrdersOverview> {
  const settings = await getOrgSettings();
  const excluded = new Set(settings.excludedShopifySources ?? []);
  const connected = new Set(connectedChannels);

  const orders = await prisma.salesOrder.findMany({
    orderBy: { orderedAt: "desc" },
    select: {
      id: true,
      channel: true,
      source: true,
      sourceLabel: true,
      orderedAt: true,
      currency: true,
      cancelled: true,
      // Revenue is summed from the LINES, not SalesOrder.total: channel-mirrored orders (TikTok in
      // Shopify) record a $0 order total there while the line prices are the real ones.
      lines: { select: { quantity: true, unitPrice: true } },
    },
  });

  // Distinct mirrored Shopify sources whose channel is connected → the exclusion toggles.
  const sourceCounts = new Map<string, { channel: string; count: number }>();
  for (const o of orders) {
    if (o.channel !== "SHOPIFY" || !o.source) continue;
    const ch = mirrorChannel(o.source);
    if (!ch || !connected.has(ch)) continue; // only offer to exclude a channel we pull directly
    const cur = sourceCounts.get(o.source) ?? { channel: ch, count: 0 };
    cur.count++;
    sourceCounts.set(o.source, cur);
  }
  const sources: SourceToggle[] = [...sourceCounts.entries()]
    .map(([source, { channel, count }]) => ({ source, label: CHANNEL_LABEL_FROM_KEY[channel] ?? channel, count, excluded: excluded.has(source) }))
    .sort((a, b) => b.count - a.count);

  const isExcluded = (channel: string, source: string | null) =>
    channel === "SHOPIFY" && !!source && excluded.has(source);

  const channelMap = new Map<string, ChannelSummary>();
  let totalOrders = 0;
  let totalUnits = 0;
  let totalRevenue = 0;
  const recent: OrderRow[] = [];

  for (const o of orders) {
    const units = o.lines.reduce((s, l) => s + l.quantity, 0);
    const revenue = o.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const dropped = isExcluded(o.channel, o.source);
    if (!dropped && !o.cancelled) {
      const c = channelMap.get(o.channel) ?? { channel: o.channel, label: CHANNEL_LABEL[o.channel] ?? o.channel, orders: 0, units: 0, revenue: 0 };
      c.orders++;
      c.units += units;
      c.revenue += revenue;
      channelMap.set(o.channel, c);
      totalOrders++;
      totalUnits += units;
      totalRevenue += revenue;
    }
    if (recent.length < recentLimit) {
      recent.push({
        id: o.id,
        channel: o.channel,
        channelLabel: CHANNEL_LABEL[o.channel] ?? o.channel,
        sourceLabel: o.sourceLabel,
        orderedAt: o.orderedAt.toISOString(),
        units,
        total: revenue,
        currency: o.currency,
        cancelled: o.cancelled,
        excluded: dropped,
      });
    }
  }

  return {
    channels: [...channelMap.values()].sort((a, b) => b.revenue - a.revenue),
    totalOrders,
    totalUnits,
    totalRevenue,
    currency: orders[0]?.currency ?? "USD",
    sources,
    recent,
  };
}
