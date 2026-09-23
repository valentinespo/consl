import { requireView } from "@/lib/membership";
import { getOrdersChart, getOrdersPage, fulfilledAtOptions, feeRuleOptions, tagOptions, salesChannelOptions, unplacedOrderCount, isOrderTag, companyTimeZone, type OrdersFilter } from "@/lib/order-metrics";
import { dayIn, todayIn } from "@/lib/channel-tz";
import { prisma } from "@/lib/prisma";
import { OrdersClient } from "@/components/OrdersClient";
import { rangeBounds, RANGES, type RangeKey } from "@/lib/chart";

export const dynamic = "force-dynamic";

/**
 * Orders — the Finances section's order feed and the home for profit tracking to come. Shows every
 * order pulled from the connected channels, paged and filterable, with the double-count guard for
 * channels that mirror into Shopify. Gated on "dashboard" (analytics-level visibility).
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireView("dashboard");
  const sp = await searchParams;
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

  const channel = ["AMAZON", "SHOPIFY", "TIKTOK"].includes(str(sp.channel) ?? "") ? str(sp.channel) : undefined;
  const tag = isOrderTag(str(sp.tag)) ? str(sp.tag) : undefined;

  // The same range vocabulary as the dashboard chart: a preset key, or "custom" + from/to days.
  // Days are the company's (its time zone setting), as on the P&L: "today" is today there.
  const isKey = (v: string | undefined): v is RangeKey => !!v && RANGES.some((r) => r.key === v);
  const rangeKey: RangeKey = isKey(str(sp.range)) ? (str(sp.range) as RangeKey) : "all";
  const [tz, oldestRow, conns] = await Promise.all([
    companyTimeZone(),
    prisma.salesOrder.findFirst({ orderBy: { orderedAt: "asc" }, select: { orderedAt: true } }),
    prisma.integration.findMany({
      where: { status: "connected", provider: { in: ["amazon", "shopify", "tiktok"] } },
      select: { provider: true },
    }),
  ]);
  const newest = todayIn(tz);
  const oldest = oldestRow ? dayIn(oldestRow.orderedAt, tz) : newest;
  const b = rangeBounds(rangeKey, newest, str(sp.from), str(sp.to));

  const filter: OrdersFilter = {
    channel,
    from: rangeKey === "all" ? undefined : (b.from ?? undefined),
    to: rangeKey === "all" ? undefined : (b.to ?? undefined),
    q: str(sp.q),
    fulfilledAt: str(sp.fulfilled),
    tag,
    source: str(sp.source),
  };

  const connectedChannels = conns.map((c) => c.provider.toUpperCase());

  const [chart, orders, orgSettings, fees, fulfilledOptions, tags, sources, unplaced] = await Promise.all([
    getOrdersChart(filter, { from: b.from ?? oldest, to: b.to ?? newest, allTime: rangeKey === "all" }),
    getOrdersPage(page, 50, filter),
    prisma.settings.findFirst({ select: { ordersBackfillCursor: true, ordersBackfillPass: true, shopifySyncedThrough: true, tiktokSyncedThrough: true } }),
    feeRuleOptions(),
    fulfilledAtOptions(),
    tagOptions(),
    salesChannelOptions(),
    unplacedOrderCount(),
  ]);

  // The Amazon history walk is "done" once the verification pass has also reached the ~2-year
  // retention floor; until then the tab shows a quiet importing hint. The floor comparison keeps
  // working as time moves: an old done-cursor only gets further below the sliding floor.
  const floorISO = new Date(Date.now() - 700 * 86_400_000).toISOString().slice(0, 10);
  const walkDone =
    (orgSettings?.ordersBackfillPass ?? 0) >= 1 &&
    !!orgSettings?.ordersBackfillCursor &&
    orgSettings.ordersBackfillCursor <= floorISO;
  const historyImporting = connectedChannels.includes("AMAZON") && !walkDone;
  // Channels whose first history pull hasn't finished yet — the tab says so while it fills.
  const importing = [
    ...(historyImporting ? ["Amazon"] : []),
    ...(connectedChannels.includes("SHOPIFY") && !orgSettings?.shopifySyncedThrough ? ["Shopify"] : []),
    ...(connectedChannels.includes("TIKTOK") && !orgSettings?.tiktokSyncedThrough ? ["TikTok"] : []),
  ];
  return (
    <>
      <OrdersClient
        chart={chart}
        orders={orders}
        connectedChannels={connectedChannels}
        importing={importing}
        fees={fees}
        fulfilledOptions={fulfilledOptions}
        tagOptions={tags}
        sourceOptions={sources}
        unplaced={unplaced}
        filter={{
          channel: channel ?? "",
          range: { key: rangeKey, from: b.from ?? oldest, to: b.to ?? newest },
          q: str(sp.q) ?? "",
          fulfilledAt: str(sp.fulfilled) ?? "",
          tag: tag ?? "",
          source: str(sp.source) ?? "",
        }}
        dataBounds={{ newest, oldest }}
        timeZone={tz}
      />
    </>
  );
}
