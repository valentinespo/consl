import "server-only";
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
  /** The platform's own words for where it shipped from (kept for the record). */
  fulfillmentLabel: string | null;
  /** The consl facility it counts as fulfilled from — the correction if there is one, else the detected one. */
  fulfilledAt: { id: string; name: string } | null;
  /** The facility detected from the platform, when a correction replaced it. */
  fulfilledAtDetected: { id: string; name: string } | null;
  /** A non-Amazon order that shipped from Amazon FBA — through MCF. */
  viaMcf: boolean;
  /** How the buyer paid: the platform's gateway key, and the wallet/card behind it. Null when the platform never says (Amazon). */
  paymentMethod: string | null;
  paymentDetail: string | null;
  /** Processor fees the platform itself reported for this order (the Shopify Payments ledger, TikTok's statements). */
  platformFees: { name: string; amount: number }[];
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
  /** Custom fees on the order — from a rule (fromRule) or written by hand. */
  fees: { id: string; name: string; amount: number; fromRule: boolean }[];
  feeTotal: number;
};

export type FeeRuleRow = {
  id: string;
  name: string;
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
  const [rules, sources, facilities, settings, oldestRow, methods] = await Promise.all([
    prisma.orderFeeRule.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { fees: true } }, facility: { select: { id: true, name: true } } } }),
    prisma.salesOrder.groupBy({ by: ["source", "sourceLabel"], where: { channel: "SHOPIFY", source: { not: null } } }),
    prisma.facility.findMany({ where: { inactive: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
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
  ]);
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
      id: r.id, name: r.name, kind: r.kind, value: r.value, extraFixed: r.extraFixed, bucket: r.bucket, channel: r.channel, source: r.source,
      paymentMethod: r.paymentMethod, facility: r.facility, tag: r.tag, appliesToPast: r.appliesToPast,
      period: r.periodFrom ? { from: dayIn(r.periodFrom, tz), to: r.periodTo ? dayIn(r.periodTo, tz) : null } : null,
      active: r.active, orders: r._count.fees,
    })),
    sources: src,
    paymentMethods,
    facilities,
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
export async function activeExclusions(alsoConnected: Iterable<string> = []): Promise<Exclusions> {
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
      externalId: true,
      orderNumber: true,
      channel: true,
      source: true,
      sourceLabel: true,
      fulfillmentLabel: true,
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
      lines: { select: { quantity: true } },
      fees: { select: { id: true, name: true, amount: true, ruleId: true }, orderBy: { createdAt: "asc" } },
    },
  });

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
    fulfilledAt: (o.fulfillmentOverrideFacility ?? o.fulfillmentFacility) ? { id: (o.fulfillmentOverrideFacility ?? o.fulfillmentFacility)!.id, name: (o.fulfillmentOverrideFacility ?? o.fulfillmentFacility)!.name } : null,
    fulfilledAtDetected: o.fulfillmentOverrideFacility && o.fulfillmentFacility ? { id: o.fulfillmentFacility.id, name: o.fulfillmentFacility.name } : null,
    viaMcf: o.channel !== "AMAZON" && (o.fulfillmentOverrideFacility ?? o.fulfillmentFacility)?.channel === "AMAZON_FBA",
    paymentMethod: o.paymentMethod,
    paymentDetail: o.paymentDetail,
    platformFees: platformFees.get(`${o.channel}|${o.externalId}`) ?? [],
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
    fees: o.fees.map((f) => ({ id: f.id, name: f.name, amount: f.amount, fromRule: f.ruleId !== null })),
    feeTotal: o.fees.reduce((s, f) => s + f.amount, 0),
  }));

  return { rows, total, page: current, pageSize, pageCount };
}
