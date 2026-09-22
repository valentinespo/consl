import "server-only";
import { prisma } from "@/lib/prisma";
import { getLtvContext } from "@/lib/ltv-context";
import { buildLtvReport, ltvDay, validLtvDay, LTV_METRICS, type CohortInterval, type LtvMetric, type LtvOrder } from "@/lib/ltv";
import { readLtvFacts, readChannelOverrides, channelExcluded, LTV_FACTS_VERSION } from "@/lib/ltv-shopify";
import { readLtvSyncState } from "@/lib/shopify-ltv";
import { RANGES, rangeBounds, type RangeKey } from "@/lib/chart";

export async function getLtvData(search: Record<string, string | string[] | undefined>) {
  // Capture the revision first. A concurrent write can leave it behind the report, but must
  // never tag old order data with a newer revision that the browser would consider current.
  const { connection, settings, org, revision } = await getLtvContext();
  // Use the same flag written by the Orders tab and automatic void rules. Filtering here
  // also keeps voided orders out of date bounds, currency choices and import diagnostics.
  const stored = await prisma.salesOrder.findMany({ where: { channel: "SHOPIFY", voided: false }, select: { externalId: true, customerId: true, orderedAt: true, cancelled: true, voided: true, status: true, currency: true, ltvData: true }, orderBy: { orderedAt: "asc" } });
  const str = (key: string) => typeof search[key] === "string" ? search[key] as string : "";
  const now = new Date();
  const timezone = connection?.timezone || "UTC";
  const today = ltvDay(now, timezone);
  const rangeKey = (RANGES.some((r) => r.key === str("range")) ? str("range") : validLtvDay(str("from")) && validLtvDay(str("to")) ? "custom" : "365") as RangeKey;
  const interval = (["week", "month", "quarter", "year"].includes(str("interval")) ? str("interval") : "month") as CohortInterval;
  const metric = (LTV_METRICS.some((m) => m.key === str("metric")) ? str("metric") : "ltv") as LtvMetric;
  const cumulative = str("cumulative") !== "0";
  const requestedHorizon = Number(str("horizon"));
  const horizon: number | "lifetime" = Number.isFinite(requestedHorizon) && requestedHorizon > 0
    ? Math.max(1, Math.min(3650, Math.floor(requestedHorizon)))
    : "lifetime";
  const horizons = [...new Set([30, 60, 90, 180, 365, 730, ...(horizon === "lifetime" ? [] : [horizon])])].sort((a, b) => a - b);
  const overrides = readChannelOverrides(settings?.ltvExcludedChannels);
  const orders: LtvOrder[] = [];
  const sources = new Map<string, { key: string; label: string; orders: number; excluded: boolean }>();
  let unenrichedOrders = 0;
  for (const order of stored) {
    const facts = readLtvFacts(order.ltvData);
    if (!facts) { unenrichedOrders++; continue; }
    if (!connection || facts.shop !== connection.sellerId) continue;
    const source = sources.get(facts.channelKey) ?? { key: facts.channelKey, label: facts.channelLabel, orders: 0, excluded: channelExcluded(facts.channelKey, facts.channelLabel, overrides) };
    source.orders++;
    source.label = facts.channelLabel;
    sources.set(source.key, source);
    // Keep excluded channels in the settings list, but never let their orders determine report
    // currencies, date bounds, customer acquisition or any metric.
    if (source.excluded) continue;
    orders.push({ id: order.externalId, customerId: order.customerId, orderedAt: order.orderedAt, cancelled: order.cancelled, voided: order.voided, status: order.status, currency: order.currency, facts });
  }
  // All Shopify amounts arrive in shopMoney, never the buyer's presentment currency. A store
  // currency change is reported explicitly; unlike currencies are never silently added.
  const currencies = [...new Set(orders.map((o) => o.currency))].sort();
  const currency = currencies.includes(str("currency")) ? str("currency") : orders.at(-1)?.currency || org?.currencyCode || "USD";
  const oldest = orders[0] ? ltvDay(orders[0].orderedAt, timezone) : today;
  const bounds = rangeBounds(rangeKey, today, validLtvDay(str("from")) ? str("from") : oldest, validLtvDay(str("to")) ? str("to") : today);
  const from = bounds.from ?? oldest;
  const to = bounds.to && bounds.to < today ? bounds.to : today;
  const state = readLtvSyncState(settings?.shopifyLtvState);
  const sync = state?.shop === connection?.sellerId && state?.factsVersion === LTV_FACTS_VERSION ? state : null;
  const ready = !!sync?.completedAt && sync.historyAccess;
  const filterError = from > to ? "Choose an acquisition start date on or before the end date." : null;
  const options = { from, to, asOf: now, timezone, currency, interval, horizons, cumulative, excludedChannels: overrides };
  // Suppress partial-history cohort numbers: without complete history an old customer can be
  // mistaken for a newly acquired one. Progress and channels remain visible while importing.
  const report = buildLtvReport(ready && !filterError ? orders : [], options);
  // KPI windows always mean cumulative LTV, even when the matrix is showing period-only sales.
  const cumulativeReport = cumulative ? report : buildLtvReport(ready && !filterError ? orders : [], { ...options, cumulative: true });
  return {
    revision,
    report,
    kpis: cumulativeReport.summary,
    filters: { range: { key: rangeKey, from, to }, from, to, interval, metric, cumulative, horizon, currency },
    horizons,
    channels: [...sources.values()].sort((a, b) => a.label.localeCompare(b.label)),
    settings: { overrides },
    connected: !!connection,
    ready,
    sync,
    lastUpdated: settings?.shopifySyncedThrough?.toISOString() ?? sync?.completedAt ?? null,
    asOf: now.toISOString(),
    timezone,
    currencies,
    today,
    oldest,
    unenrichedOrders,
    filterError,
  };
}

export type LtvPageData = Awaited<ReturnType<typeof getLtvData>>;
