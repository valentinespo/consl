import { PageHeader } from "@/components/ui";
import { requireView } from "@/lib/membership";
import { getOrdersSummary, getOrdersPage, type OrdersFilter } from "@/lib/order-metrics";
import { prisma } from "@/lib/prisma";
import { OrdersClient } from "@/components/OrdersClient";

export const dynamic = "force-dynamic";

const RANGES: Record<string, number> = { "30d": 30, "90d": 90, "12m": 365 };

/**
 * Orders — the Analytics section's landing and the home for profit tracking to come. Shows every
 * order pulled from the connected channels, paged and filterable, with the double-count guard for
 * channels that mirror into Shopify. Gated on "dashboard" (analytics-level visibility).
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireView("dashboard");
  const sp = await searchParams;
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

  const channel = ["AMAZON", "SHOPIFY", "TIKTOK"].includes(str(sp.channel) ?? "") ? str(sp.channel) : undefined;
  const range = str(sp.range);
  const filter: OrdersFilter = {
    channel,
    sinceDays: range ? RANGES[range] : undefined,
    q: str(sp.q),
  };

  const conns = await prisma.integration.findMany({
    where: { status: "connected", provider: { in: ["amazon", "shopify", "tiktok"] } },
    select: { provider: true },
  });
  const connectedChannels = conns.map((c) => c.provider.toUpperCase());

  const [summary, orders] = await Promise.all([
    getOrdersSummary(connectedChannels, { channel: filter.channel, sinceDays: filter.sinceDays }),
    getOrdersPage(page, 50, filter),
  ]);
  return (
    <>
      <PageHeader title="Orders" subtitle="Every sale across your connected channels." />
      <OrdersClient
        summary={summary}
        orders={orders}
        canImport={conns.length > 0}
        filter={{ channel: channel ?? "", range: range ?? "", q: str(sp.q) ?? "" }}
      />
    </>
  );
}
