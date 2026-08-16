import { PageHeader } from "@/components/ui";
import { requireView } from "@/lib/membership";
import { getOrdersSummary, getOrdersPage, type OrdersFilter } from "@/lib/order-metrics";
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

  // The same range vocabulary as the dashboard chart: a preset key, or "custom" + from/to days.
  const isKey = (v: string | undefined): v is RangeKey => !!v && RANGES.some((r) => r.key === v);
  const rangeKey: RangeKey = isKey(str(sp.range)) ? (str(sp.range) as RangeKey) : "all";
  const newest = new Date().toISOString().slice(0, 10);
  const oldestRow = await prisma.salesOrder.findFirst({ orderBy: { orderedAt: "asc" }, select: { orderedAt: true } });
  const oldest = (oldestRow?.orderedAt ?? new Date()).toISOString().slice(0, 10);
  const b = rangeBounds(rangeKey, newest, str(sp.from), str(sp.to));

  const filter: OrdersFilter = {
    channel,
    from: rangeKey === "all" ? undefined : (b.from ?? undefined),
    to: rangeKey === "all" ? undefined : (b.to ?? undefined),
    q: str(sp.q),
  };

  const conns = await prisma.integration.findMany({
    where: { status: "connected", provider: { in: ["amazon", "shopify", "tiktok"] } },
    select: { provider: true },
  });
  const connectedChannels = conns.map((c) => c.provider.toUpperCase());

  const [summary, orders, orgSettings] = await Promise.all([
    getOrdersSummary(connectedChannels, { channel: filter.channel, from: filter.from, to: filter.to }),
    getOrdersPage(page, 50, filter),
    prisma.settings.findFirst({ select: { ordersBackfillCursor: true, ordersBackfillPass: true } }),
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
  return (
    <>
      <PageHeader title="Orders" subtitle="Every sale across your connected channels." />
      <OrdersClient
        summary={summary}
        orders={orders}
        connectedChannels={connectedChannels}
        historyImporting={historyImporting}
        filter={{
          channel: channel ?? "",
          range: { key: rangeKey, from: b.from ?? oldest, to: b.to ?? newest },
          q: str(sp.q) ?? "",
        }}
        dataBounds={{ newest, oldest }}
      />
    </>
  );
}
