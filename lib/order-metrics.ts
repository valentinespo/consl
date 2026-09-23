import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { getOrgSettings } from "@/lib/settings";
import { todayIn } from "@/lib/channel-tz";
import { paymentMethodLabel } from "@/lib/payment-methods";

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

const PLACE_CHANNEL: Record<string, string> = { AMAZON_FBA: "Amazon", AMAZON_AWD: "Amazon", SHOPIFY: "Shopify", TIKTOK: "TikTok" };

/** Display names for facilities: a name two facilities share (one warehouse that both Shopify and
 *  TikTok report) gets its platform, else its code, appended so a picker can tell them apart. */
export function distinctFacilityNames<T extends { id: string; name: string; code?: string | null; channel?: string | null }>(facilities: T[]): (T & { label: string })[] {
  const count = new Map<string, number>();
  for (const f of facilities) count.set(f.name, (count.get(f.name) ?? 0) + 1);
  return facilities.map((f) => ({
    ...f,
    label: (count.get(f.name) ?? 0) > 1 ? `${f.name} · ${(f.channel && PLACE_CHANNEL[f.channel]) || f.code || "?"}` : f.name,
  }));
}

export type OrdersFilter = {
  channel?: string; // AMAZON | SHOPIFY | TIKTOK
  from?: string; // ISO day (inclusive); undefined = beginning of time
  to?: string; // ISO day (inclusive); undefined = today
  q?: string; // free-text search — order #, amount, SKU, or words like "mcf" / "pending" / "free"
  fulfilledAt?: string; // a facility id, or "none" for orders with no facility yet
  tag?: string; // one of ORDER_TAGS — the pill an order wears (mcf, voided, …)
  source?: string; // the platform's sales-channel key (Shopify "web", "shop_app", "tiktok", "faire"…)
};

/** The sales channels orders come through — Shopify's Online Store, the Shop app, TikTok, Faire,
 *  subscriptions… — with counts: the choices of the Orders "Sales channel" filter, keyed by the
 *  platform's own source key. Amazon and TikTok orders carry none; they show "—" in the table. */
export async function salesChannelOptions(): Promise<{ id: string; name: string; orders: number }[]> {
  const rows = await prisma.salesOrder.groupBy({ by: ["source", "sourceLabel"], where: { source: { not: null } }, _count: true });
  const byKey = new Map<string, { name: string; orders: number }>();
  for (const r of rows) {
    const key = r.source as string;
    const cur = byKey.get(key);
    byKey.set(key, { name: cur?.name ?? r.sourceLabel ?? key, orders: (cur?.orders ?? 0) + r._count });
  }
  return [...byKey.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.orders - a.orders);
}

/** The facilities orders are currently fulfilled from (the correction wins over the detected one),
 *  with a "No facility" entry when some orders have none — the choices of the Orders filter. */
export async function fulfilledAtOptions(): Promise<{ id: string; name: string; orders: number }[]> {
  const orgId = await getCurrentOrgId();
  const rows = await prisma.$queryRaw<{ id: string | null; name: string | null; code: string | null; channel: string | null; orders: number }[]>`
    SELECT f.id, f.name, f.code, f.channel, COUNT(*)::int AS orders
    FROM "SalesOrder" o LEFT JOIN "Facility" f ON f.id = COALESCE(o."fulfillmentOverrideFacilityId", o."fulfillmentFacilityId")
    WHERE o."orgId" = ${orgId} GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC`;
  const named = distinctFacilityNames(rows.filter((r) => r.id).map((r) => ({ id: r.id as string, name: r.name ?? "?", code: r.code, channel: r.channel, orders: r.orders })));
  const out = named.map((r) => ({ id: r.id, name: r.label, orders: r.orders }));
  const none = rows.find((r) => !r.id);
  if (none) out.push({ id: "none", name: "No facility", orders: none.orders });
  return out;
}

function bounds(f: OrdersFilter): { since: Date | null; until: Date | null } {
  return {
    since: f.from ? new Date(`${f.from}T00:00:00Z`) : null,
    until: f.to ? new Date(`${f.to}T23:59:59.999Z`) : null,
  };
}

export type OrderLineRow = { code: string | null; name: string | null; imageUrl: string | null; sku: string | null; quantity: number; unitPrice: number };

export type OrderRow = {
  id: string;
  orderNumber: string | null;
  channel: string;
  channelLabel: string;
  sourceLabel: string | null;
  /** The platform's own words for where it shipped from (kept for the record). */
  fulfillmentLabel: string | null;
  /** The consl facility it counts as fulfilled from — the correction if there is one, else the detected one. */
  fulfilledAt: { id: string; name: string } | null;
  /** The facility detected from the platform, when a correction replaced it. */
  fulfilledAtDetected: { id: string; name: string } | null;
  /** A non-Amazon order that shipped from Amazon FBA — through MCF. */
  viaMcf: boolean;
  /** Merchant-fulfilled Amazon only: the ship-from place Amazon's live record named (its label), null until read. */
  shipFromLabel: string | null;
  /** How the buyer paid: the platform's gateway key, and the wallet/card behind it. Null when the platform never says (Amazon). */
  paymentMethod: string | null;
  paymentDetail: string | null;
  /** Processor fees the platform itself reported for this order (the Shopify Payments ledger, TikTok's statements). */
  platformFees: { name: string; amount: number }[];
  orderedAt: string;
  units: number;
  /** Every unit on the order: the consl product it maps to (code/name/picture null when the SKU isn't mapped), the SKU as sold, qty, net unit price. */
  lines: OrderLineRow[];
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
  /** Custom fees on the order — from a rule (fromRule) or written by hand. */
  fees: { id: string; name: string; amount: number; fromRule: boolean }[];
  feeTotal: number;
  /** Credits written by hand — money added to the order, with the P&L bucket each one lands in
   *  (sales | custom_fees | payment_fees). */
  credits: { id: string; name: string; amount: number; bucket: string }[];
  creditTotal: number;
};

export type FeeRuleRow = {
  id: string;
  name: string;
  /** "fee" adds a cost to matching orders; "void" takes them out of every total. */
  action: string;
  kind: string;
  value: number;
  extraFixed: number | null;
  bucket: string;
  channel: string | null;
  source: string | null;
  paymentMethod: string | null;
  facility: { id: string; name: string } | null;
  tag: string | null;
  appliesToPast: boolean;
  /** Company-calendar days the rule covers: from a day on (`to` null), or a closed period. */
  period: { from: string; to: string | null } | null;
  /** The company-calendar day the rule was created — what "from its creation on" means. */
  createdDay: string;
  active: boolean;
  orders: number;
};

/** A payment method seen on the company's orders, and whether the platform already reports its fee.
 *  `mirror` names the consl channel the method stands for when it is another channel's sale
 *  mirrored into Shopify ("tiktok_shop" → TIKTOK): those orders are counted on that channel with
 *  its own fees, never on Shopify. */
export type PaymentMethodOption = { value: string; label: string; channels: string[]; feesRead: boolean; mirror: string | null };

export type FeeRuleOptions = {
  rules: FeeRuleRow[];
  sources: { value: string; label: string }[];
  paymentMethods: PaymentMethodOption[];
  facilities: { id: string; name: string }[];
  /** Today and the oldest order, as company-calendar days — the period picker's bounds. */
  days: { today: string; oldest: string };
};

/** A date as a YYYY-MM-DD day in a time zone. */
const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** The fee rules plus the vocab the rule form offers: known Shopify sources, payment methods and the facilities. */
export async function feeRuleOptions(): Promise<FeeRuleOptions> {
  const orgId = await getCurrentOrgId();
  const [rules, sources, facilities, settings, oldestRow, methods, voidedByRule] = await Promise.all([
    prisma.orderFeeRule.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { fees: true } }, facility: { select: { id: true, name: true, code: true, channel: true } } } }),
    prisma.salesOrder.groupBy({ by: ["source", "sourceLabel"], where: { channel: "SHOPIFY", source: { not: null } } }),
    prisma.facility.findMany({ where: { inactive: false }, select: { id: true, name: true, code: true, channel: true }, orderBy: { name: "asc" } }),
    getOrgSettings(),
    prisma.salesOrder.findFirst({ orderBy: { orderedAt: "asc" }, select: { orderedAt: true } }),
    // Every payment method on record, with whether the platform's own ledger carries fees for
    // orders paid that way — what tells the rule form "consl already reads this".
    orgId
      ? prisma.$queryRaw<{ channel: string; method: string; orders: number; withFees: number }[]>`
          SELECT o.channel, o."paymentMethod" AS method, COUNT(*)::int AS orders,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM "FinanceEvent" fe
              WHERE fe."orgId" = o."orgId" AND fe.channel = o.channel AND fe."group" = 'payment_fees' AND fe."orderId" = o."externalId"))::int AS "withFees"
          FROM "SalesOrder" o
          WHERE o."orgId" = ${orgId} AND o."paymentMethod" IS NOT NULL
          GROUP BY 1, 2`
      : Promise.resolve([]),
    prisma.salesOrder.groupBy({ by: ["voidRuleId"], where: { voidRuleId: { not: null } }, _count: true }),
  ]);
  const voidedCount = new Map(voidedByRule.map((r) => [r.voidRuleId as string, r._count]));
  const facilityLabel = new Map(distinctFacilityNames(facilities).map((f) => [f.id, f.label]));
  const tz = settings.syncTz;
  const seen = new Set<string>();
  const src = sources
    .map((s) => ({ value: s.source as string, label: s.sourceLabel ?? (s.source as string) }))
    .filter((s) => !seen.has(s.value) && seen.add(s.value))
    .sort((a, b) => a.label.localeCompare(b.label));
  // One entry per method key; TikTok's own statements always carry its fees.
  const byMethod = new Map<string, { orders: number; channels: string[]; feesRead: boolean }>();
  for (const m of methods) {
    const cur = byMethod.get(m.method) ?? { orders: 0, channels: [], feesRead: false };
    byMethod.set(m.method, { orders: cur.orders + m.orders, channels: [...cur.channels, m.channel], feesRead: cur.feesRead || m.withFees > 0 || m.channel === "TIKTOK" });
  }
  const paymentMethods: PaymentMethodOption[] = [...byMethod.entries()]
    .sort((a, b) => b[1].orders - a[1].orders)
    .map(([value, v]) => {
      const mirror = mirrorChannel(value);
      return { value, label: paymentMethodLabel(value) ?? value, channels: v.channels, feesRead: v.feesRead || !!mirror, mirror };
    });
  return {
    rules: rules.map((r) => ({
      id: r.id, name: r.name, action: r.action, kind: r.kind, value: r.value, extraFixed: r.extraFixed, bucket: r.bucket, channel: r.channel, source: r.source,
      paymentMethod: r.paymentMethod, facility: r.facility ? { id: r.facility.id, name: facilityLabel.get(r.facility.id) ?? r.facility.name } : null, tag: r.tag, appliesToPast: r.appliesToPast,
      period: r.periodFrom ? { from: dayIn(r.periodFrom, tz), to: r.periodTo ? dayIn(r.periodTo, tz) : null } : null,
      createdDay: dayIn(r.createdAt, tz),
      active: r.active, orders: r.action === "void" ? voidedCount.get(r.id) ?? 0 : r._count.fees,
    })),
    sources: src,
    paymentMethods,
    facilities: distinctFacilityNames(facilities).map((f) => ({ id: f.id, name: f.label })),
    days: { today: todayIn(tz), oldest: oldestRow ? dayIn(oldestRow.orderedAt, tz) : todayIn(tz) },
  };
}

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
export type Exclusions = { sources: string[]; mcf: boolean };

/** A channel is present once it is connected OR its orders are in the feed (a history load lands
 *  before the connection does). Shared with the P&L, which drops the same orders. */
/** Read once per request however many parts of a page ask (the Orders page asks four times) —
 *  React's per-request memo, so every request still reads the database fresh. */
export const activeExclusions = cache(async function activeExclusions(alsoConnected: Iterable<string> = []): Promise<Exclusions> {
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
});

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

/** The tags an order can wear — the pills beside its number — as the values of the Orders tag filter. */
export const ORDER_TAGS = ["mcf", "replacement", "free_unit", "free_sample", "voided"] as const;
export type OrderTag = (typeof ORDER_TAGS)[number];
export const isOrderTag = (v: string | undefined): v is OrderTag => !!v && (ORDER_TAGS as readonly string[]).includes(v);
const TAG_LABEL: Record<OrderTag, string> = { mcf: "MCF", replacement: "Replacement", free_unit: "Free unit", free_sample: "Free sample", voided: "Voided" };

/** The orders wearing a tag. "Voided" is what the row shows for a manual void AND for an order
 *  the double-count rule drops, so the tag finds both — everything wearing the pill. */
function tagWhere(tag: OrderTag, ex: Exclusions): Record<string, unknown> {
  switch (tag) {
    case "mcf":
      return { mcf: true };
    case "replacement":
      return { replacement: true };
    case "free_unit":
      return FREE_UNIT_WHERE;
    case "free_sample":
      return FREE_SAMPLE_WHERE;
    case "voided":
      return {
        OR: [
          { voided: true },
          ...(ex.sources.length ? [{ channel: "SHOPIFY", source: { in: ex.sources } }] : []),
          ...(ex.mcf ? [{ channel: "AMAZON", mcf: true }] : []),
        ],
      };
  }
}

/** Each tag with how many orders wear it — the choices of the Orders tag filter (a tag nobody wears is left out). */
export async function tagOptions(): Promise<{ id: string; name: string; orders: number }[]> {
  const ex = await activeExclusions();
  const counts = await Promise.all(ORDER_TAGS.map((t) => prisma.salesOrder.count({ where: tagWhere(t, ex) })));
  return ORDER_TAGS.map((t, i) => ({ id: t, name: TAG_LABEL[t], orders: counts[i] })).filter((o) => o.orders > 0);
}

/** Orders that count (not cancelled, not voided, not dropped by the double-count rule) and still
 *  have no facility — the ones a person has to place. Until then Reorder 2.0 counts them nowhere
 *  and the P&L prices their units at average cost. */
export async function unplacedOrderCount(): Promise<number> {
  const ex = await activeExclusions();
  const dropped = [
    ...(ex.sources.length ? [{ channel: "SHOPIFY", source: { in: ex.sources } }] : []),
    ...(ex.mcf ? [{ channel: "AMAZON", mcf: true }] : []),
  ];
  return prisma.salesOrder.count({
    where: {
      fulfillmentOverrideFacilityId: null,
      fulfillmentFacilityId: null,
      cancelled: false,
      voided: false,
      ...(dropped.length ? { NOT: dropped } : {}),
    },
  });
}

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

  if (["mcf", "multichannel", "multi-channel"].includes(s)) return tagWhere("mcf", ex);
  if (["replacement", "replacements"].includes(s)) return tagWhere("replacement", ex);
  if (["free", "free unit", "free units", "vine"].includes(s)) return tagWhere("free_unit", ex);
  if (["sample", "samples", "free sample", "free samples"].includes(s)) return tagWhere("free_sample", ex);
  if (["cancelled", "canceled"].includes(s)) return { cancelled: true };
  if (["voided", "void", "excluded"].includes(s)) return tagWhere("voided", ex);
  if (s === "pending") return { status: contains("pending") };
  if (s === "unshipped") return { status: contains("unshipped") };
  if (["shipped", "partially shipped"].includes(s)) return { OR: [{ status: "Shipped" }, { status: "PartiallyShipped" }] };
  if (["amazon", "shopify", "tiktok"].includes(s)) return { channel: s.toUpperCase() };
  if (["fba", "merchant"].includes(s)) return { OR: [{ fulfillmentLabel: contains(s) }, { fulfillmentFacility: { name: contains(s) } }] };

  const amount = /^[0-9]+([.,][0-9]{1,2})?$/.test(s) ? Number(s.replace(",", ".")) : null;
  return {
    OR: [
      { orderNumber: contains(q) },
      { sourceLabel: contains(q) },
      // "paypal", "shop pay", "shopify payments" — the method key or the wallet/card behind it.
      { paymentMethod: contains(s.replace(/\s+/g, "_")) },
      { paymentDetail: contains(q) },
      { fulfillmentLabel: contains(q) },
      { fulfillmentFacility: { name: contains(q) } },
      { fulfillmentOverrideFacility: { name: contains(q) } },
      { status: contains(q) },
      { lines: { some: { sku: contains(q) } } },
      // An amount searches the paid total within a cent, so "23.4" finds $23.40.
      ...(amount != null ? [{ total: { gte: amount - 0.005, lte: amount + 0.005 } }] : []),
    ],
  };
}

/** One page of orders, newest first, honouring the filters + search. Excluded/cancelled orders
 *  still show (dimmed) for transparency. */
/** The columns one Orders table row shows. */
const ORDER_ROW_SELECT = {
  id: true,
  externalId: true,
  orderNumber: true,
  channel: true,
  source: true,
  sourceLabel: true,
  fulfillmentLabel: true,
  shipFromLabel: true,
  paymentMethod: true,
  paymentDetail: true,
  fulfillmentFacility: { select: { id: true, name: true, channel: true } },
  fulfillmentOverrideFacility: { select: { id: true, name: true, channel: true } },
  orderedAt: true,
  total: true,
  currency: true,
  status: true,
  cancelled: true,
  mcf: true,
  replacement: true,
  voided: true,
  lines: { select: { quantity: true, sku: true, unitPrice: true, product: { select: { code: true, name: true, imageUrl: true } } } },
  fees: { select: { id: true, name: true, amount: true, ruleId: true, type: true, bucket: true }, orderBy: { createdAt: "asc" } },
} as const;

/** The Orders filters as one where clause — the table's list and the header chart read the same
 *  orders from it. */
function ordersWhere(filter: OrdersFilter, ex: Exclusions): Record<string, unknown> {
  const { since, until } = bounds(filter);
  const q = filter.q?.trim();
  // The tag filter and the search both narrow the list; each is one clause of the AND.
  const narrow = [...(isOrderTag(filter.tag) ? [tagWhere(filter.tag, ex)] : []), ...(q ? [searchWhere(q, ex)] : [])];
  return {
    ...(filter.channel ? { channel: filter.channel } : {}),
    ...(filter.source ? { source: filter.source } : {}),
    ...(since || until ? { orderedAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {}),
    // Fulfilled at: the correction when there is one, else the detected facility.
    ...(filter.fulfilledAt === "none"
      ? { fulfillmentOverrideFacilityId: null, fulfillmentFacilityId: null }
      : filter.fulfilledAt
        ? { OR: [{ fulfillmentOverrideFacilityId: filter.fulfilledAt }, { fulfillmentOverrideFacilityId: null, fulfillmentFacilityId: filter.fulfilledAt }] }
        : {}),
    ...(narrow.length ? { AND: narrow } : {}),
  };
}

export async function getOrdersPage(page = 1, pageSize = 50, filter: OrdersFilter = {}): Promise<OrdersPage> {
  const { sources: excluded, mcf: excludeMcf } = await activeExclusions();
  const ex: Exclusions = { sources: excluded, mcf: excludeMcf };
  const where = ordersWhere(filter, ex);

  // The count, the facility names and the requested page's rows are read side by side; a page past
  // the end (the filter just shrank the list) is read again at the last page.
  const readPage = (p: number) =>
    prisma.salesOrder.findMany({
      where,
      orderBy: { orderedAt: "desc" },
      skip: (p - 1) * pageSize,
      take: pageSize,
      select: ORDER_ROW_SELECT,
    });
  const requested = Math.max(1, page);
  const [total, facilities, firstTry] = await Promise.all([
    prisma.salesOrder.count({ where }),
    prisma.facility.findMany({ select: { id: true, name: true, code: true, channel: true } }),
    readPage(requested),
  ]);
  // Display names for the Fulfilled at column: one warehouse two platforms report gets its platform appended.
  const placeLabel = new Map(distinctFacilityNames(facilities).map((f) => [f.id, f.label]));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(requested, pageCount);
  const orders = current === requested ? firstTry : await readPage(current);

  // What the platform itself charged to process each order on this page — shown beside any
  // manual fee so a processor's charge is never entered twice.
  const feeRows = orders.length
    ? await prisma.financeEvent.findMany({
        where: { group: "payment_fees", orderId: { in: orders.map((o) => o.externalId) } },
        select: { channel: true, orderId: true, type: true, amount: true, baseAmount: true },
      })
    : [];
  const platformFees = new Map<string, { name: string; amount: number }[]>();
  for (const f of feeRows) {
    const k = `${f.channel}|${f.orderId}`;
    platformFees.set(k, [...(platformFees.get(k) ?? []), { name: f.type, amount: f.baseAmount ?? f.amount }]);
  }

  const rows: OrderRow[] = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    channel: o.channel,
    channelLabel: CHANNEL_LABEL[o.channel] ?? o.channel,
    sourceLabel: o.sourceLabel,
    fulfillmentLabel: o.fulfillmentLabel,
    fulfilledAt: (o.fulfillmentOverrideFacility ?? o.fulfillmentFacility) ? { id: (o.fulfillmentOverrideFacility ?? o.fulfillmentFacility)!.id, name: placeLabel.get((o.fulfillmentOverrideFacility ?? o.fulfillmentFacility)!.id) ?? (o.fulfillmentOverrideFacility ?? o.fulfillmentFacility)!.name } : null,
    fulfilledAtDetected: o.fulfillmentOverrideFacility && o.fulfillmentFacility ? { id: o.fulfillmentFacility.id, name: placeLabel.get(o.fulfillmentFacility.id) ?? o.fulfillmentFacility.name } : null,
    viaMcf: o.channel !== "AMAZON" && (o.fulfillmentOverrideFacility ?? o.fulfillmentFacility)?.channel === "AMAZON_FBA",
    shipFromLabel: o.shipFromLabel,
    paymentMethod: o.paymentMethod,
    paymentDetail: o.paymentDetail,
    platformFees: platformFees.get(`${o.channel}|${o.externalId}`) ?? [],
    orderedAt: o.orderedAt.toISOString(),
    units: o.lines.reduce((s, l) => s + l.quantity, 0),
    lines: o.lines.map((l) => ({ code: l.product?.code ?? null, name: l.product?.name ?? null, imageUrl: l.product?.imageUrl ?? null, sku: l.sku, quantity: l.quantity, unitPrice: l.unitPrice })),
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
    fees: o.fees.filter((f) => f.type !== "credit").map((f) => ({ id: f.id, name: f.name, amount: f.amount, fromRule: f.ruleId !== null })),
    feeTotal: o.fees.filter((f) => f.type !== "credit").reduce((s, f) => s + f.amount, 0),
    credits: o.fees.filter((f) => f.type === "credit").map((f) => ({ id: f.id, name: f.name, amount: f.amount, bucket: f.bucket })),
    creditTotal: o.fees.filter((f) => f.type === "credit").reduce((s, f) => s + f.amount, 0),
  }));

  return { rows, total, page: current, pageSize, pageCount };
}

/* ------------------------------------------------------------------------------------------------
 * The Orders header chart: orders and units over the range, bucketed so a lifetime never becomes
 * hundreds of hairlines — by day up to ~6 weeks, by week up to ~9 months, then by month (by
 * quarter past five years). Days are UTC calendar days, the same calendar the Orders filters use.
 * ---------------------------------------------------------------------------------------------- */

export type ChartBucket = "day" | "week" | "month" | "quarter";

export type OrdersChartPoint = {
  start: string; // first day the bar covers (YYYY-MM-DD), clipped to the range
  end: string; // last day it covers, clipped to the range
  orders: number;
  units: number;
  /** The bar is short of a whole bucket: the range starts or ends inside it, or it is still running. */
  partial: boolean;
};

export type OrdersChart = {
  bucket: ChartBucket;
  from: string;
  to: string;
  points: OrdersChartPoint[];
  channels: { channel: string; label: string; orders: number; units: number }[];
  totals: { orders: number; units: number };
  /** The same filters over the equally long window just before the range — null for All time. */
  previous: { orders: number; units: number; days: number } | null;
};

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const utcDay = (s: string) => new Date(`${s}T00:00:00Z`);

function chartBucketFor(days: number): ChartBucket {
  if (days <= 45) return "day";
  if (days <= 270) return "week";
  if (days <= 1830) return "month";
  return "quarter";
}

/** The first day of the bucket holding `d` — weeks start on Monday, as Postgres' date_trunc does. */
function bucketStart(d: Date, b: ChartBucket): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (b === "day") return new Date(Date.UTC(y, m, d.getUTCDate()));
  if (b === "week") return new Date(Date.UTC(y, m, d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  if (b === "month") return new Date(Date.UTC(y, m, 1));
  return new Date(Date.UTC(y, m - (m % 3), 1));
}

function nextBucket(d: Date, b: ChartBucket): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (b === "day") return new Date(Date.UTC(y, m, d.getUTCDate() + 1));
  if (b === "week") return new Date(Date.UTC(y, m, d.getUTCDate() + 7));
  if (b === "month") return new Date(Date.UTC(y, m + 1, 1));
  return new Date(Date.UTC(y, m + 3, 1));
}

/**
 * The header chart for the Orders tab under the page's filters. It counts the orders the table
 * lists, less the ones that count nowhere (cancelled, voided, a mirrored copy of another channel's
 * sale) — unless the filter asks for exactly those (the Voided or MCF tag, a mirrored sales
 * channel, a search for cancelled/voided/MCF), when it counts what is listed. All time starts at
 * the first order the filters match.
 */
export async function getOrdersChart(filter: OrdersFilter, range: { from: string; to: string; allTime: boolean }): Promise<OrdersChart> {
  const empty: OrdersChart = { bucket: "day", from: range.from, to: range.to, points: [], channels: [], totals: { orders: 0, units: 0 }, previous: null };
  const orgId = await getCurrentOrgId();
  if (!orgId) return empty;
  const ex = await activeExclusions();

  const q = (filter.q ?? "").trim();
  // A filter that asks for orders the count normally leaves out (voided, cancelled, MCF copies, a
  // mirrored sales channel) gets exactly what the table lists — a chart of zeros would say nothing.
  const wantsUncounted =
    filter.tag === "voided" ||
    filter.tag === "mcf" ||
    ["cancelled", "canceled", "voided", "void", "excluded", "mcf", "multichannel", "multi-channel"].includes(q.toLowerCase()) ||
    (!!filter.source && ex.sources.includes(filter.source));
  const narrowed = !!q || isOrderTag(filter.tag);

  let from = utcDay(range.from);
  const to = utcDay(range.to);
  const spanOf = (a: Date) => Math.max(1, Math.round((to.getTime() - a.getTime()) / DAY_MS) + 1);
  // The window read: the range, plus the equally long stretch before it for the comparison.
  const prevFrom = range.allTime ? null : new Date(from.getTime() - spanOf(from) * DAY_MS);
  const windowStart = isoDay(prevFrom ?? from);
  const toEndStr = `${range.to} 23:59:59.999`;

  // Which orders: a search or a tag goes through the table's own where clause (it reaches into
  // lines, facilities and tags, and narrows to few orders); plain filters are read in SQL directly.
  let ids: string[] | null = null;
  if (narrowed) {
    const dropped = [
      ...(ex.sources.length ? [{ channel: "SHOPIFY", source: { in: ex.sources } }] : []),
      ...(ex.mcf ? [{ channel: "AMAZON", mcf: true }] : []),
    ];
    const counting = wantsUncounted ? {} : { cancelled: false, voided: false, ...(dropped.length ? { NOT: dropped } : {}) };
    const base = ordersWhere({ ...filter, from: undefined, to: undefined }, ex);
    ids = (
      await prisma.salesOrder.findMany({
        where: { AND: [base, counting, { orderedAt: { gte: utcDay(windowStart), lte: new Date(to.getTime() + DAY_MS - 1) } }] },
        select: { id: true },
      })
    ).map((o) => o.id);
    if (ids.length === 0) return empty;
  }
  const channel = narrowed ? null : (filter.channel ?? null);
  const source = narrowed ? null : (filter.source ?? null);
  const place = narrowed ? null : (filter.fulfilledAt ?? null);
  // Buckets are cut on the finest grain the range could need; `first` finds where All time starts.
  const scan = (bucket: ChartBucket, lo: string, hi: string) => prisma.$queryRaw<{ b: string; channel: string; orders: number; units: number; first: string }[]>`
    SELECT to_char(date_trunc(${bucket}::text, o."orderedAt"), 'YYYY-MM-DD') AS b, o.channel,
      COUNT(DISTINCT o.id)::int AS orders, COALESCE(SUM(l.quantity), 0)::int AS units,
      to_char(MIN(o."orderedAt"), 'YYYY-MM-DD') AS first
    FROM "SalesOrder" o
    LEFT JOIN "SalesOrderLine" l ON l."orderId" = o.id
    WHERE o."orgId" = ${orgId}
      AND o."orderedAt" >= ${lo}::timestamp AND o."orderedAt" <= ${hi}::timestamp
      AND (${ids}::text[] IS NULL OR o.id = ANY(${ids}::text[]))
      AND (${ids}::text[] IS NOT NULL OR (
        (${wantsUncounted}::boolean OR (
          o.cancelled = false AND o.voided = false
          AND NOT (o.channel = 'SHOPIFY' AND COALESCE(o.source, '') = ANY(${ex.sources}::text[]))
          AND NOT (${ex.mcf}::boolean AND o.channel = 'AMAZON' AND o.mcf)))
        AND (${channel}::text IS NULL OR o.channel = ${channel})
        AND (${source}::text IS NULL OR o.source = ${source})
        AND (${place}::text IS NULL
          OR (${place} = 'none' AND o."fulfillmentOverrideFacilityId" IS NULL AND o."fulfillmentFacilityId" IS NULL)
          OR (${place} <> 'none' AND (o."fulfillmentOverrideFacilityId" = ${place}
            OR (o."fulfillmentOverrideFacilityId" IS NULL AND o."fulfillmentFacilityId" = ${place}))))))
    GROUP BY 1, 2`;

  // All time: find the first matching order, then cut buckets for the span it gives.
  let probe: Awaited<ReturnType<typeof scan>> | null = null;
  if (range.allTime) {
    probe = await scan("month", windowStart, toEndStr);
    const first = probe.reduce<string | null>((m, r) => (!m || r.first < m ? r.first : m), null);
    if (!first) return empty;
    from = utcDay(first);
  }
  const days = spanOf(from);
  const bucket = chartBucketFor(days);
  const fromDay = isoDay(from);
  const [rows, prevRows] = await Promise.all([
    probe && bucket === "month" ? Promise.resolve(probe) : scan(bucket, fromDay, toEndStr),
    prevFrom ? scan("month", isoDay(prevFrom), `${isoDay(new Date(from.getTime() - DAY_MS))} 23:59:59.999`) : Promise.resolve([]),
  ]);
  const previous: OrdersChart["previous"] = prevFrom
    ? { orders: prevRows.reduce((t, r) => t + r.orders, 0), units: prevRows.reduce((t, r) => t + r.units, 0), days }
    : null;

  const byBucket = new Map<string, { orders: number; units: number }>();
  const byChannel = new Map<string, { orders: number; units: number }>();
  for (const r of rows) {
    const b = byBucket.get(r.b) ?? { orders: 0, units: 0 };
    b.orders += r.orders;
    b.units += r.units;
    byBucket.set(r.b, b);
    const c = byChannel.get(r.channel) ?? { orders: 0, units: 0 };
    c.orders += r.orders;
    c.units += r.units;
    byChannel.set(r.channel, c);
  }

  const today = isoDay(new Date());
  const points: OrdersChartPoint[] = [];
  for (let s = bucketStart(from, bucket); s <= to; s = nextBucket(s, bucket)) {
    const last = new Date(nextBucket(s, bucket).getTime() - DAY_MS);
    const v = byBucket.get(isoDay(s)) ?? { orders: 0, units: 0 };
    points.push({
      start: isoDay(s < from ? from : s),
      end: isoDay(last > to ? to : last),
      orders: v.orders,
      units: v.units,
      partial: s < from || last > to || isoDay(last) >= today,
    });
  }
  const channels = [...byChannel.entries()]
    .map(([channel, v]) => ({ channel, label: CHANNEL_LABEL[channel] ?? channel, ...v }))
    .sort((a, b) => b.orders - a.orders);
  return {
    bucket,
    from: fromDay,
    to: range.to,
    points,
    channels,
    totals: { orders: channels.reduce((t, c) => t + c.orders, 0), units: channels.reduce((t, c) => t + c.units, 0) },
    previous,
  };
}
