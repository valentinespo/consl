import { PageHeader } from "@/components/ui";
import { requireView } from "@/lib/membership";
import { getOrdersSummary, getOrdersPage } from "@/lib/order-metrics";
import { prisma } from "@/lib/prisma";
import { OrdersClient } from "@/components/OrdersClient";

export const dynamic = "force-dynamic";

/**
 * Orders — the Analytics section's landing and the home for profit tracking to come. Shows every
 * order pulled from the connected channels, paged, with the double-count guard for channels that
 * mirror into Shopify. Gated on "dashboard" (analytics-level visibility).
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireView("dashboard");
  const sp = await searchParams;
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);

  const conns = await prisma.integration.findMany({
    where: { status: "connected", provider: { in: ["amazon", "shopify", "tiktok"] } },
    select: { provider: true },
  });
  const connectedChannels = conns.map((c) => c.provider.toUpperCase());

  const [summary, orders] = await Promise.all([getOrdersSummary(connectedChannels), getOrdersPage(page, 50)]);
  return (
    <>
      <PageHeader title="Orders" subtitle="Every sale across your connected channels." />
      <OrdersClient summary={summary} orders={orders} canImport={conns.length > 0} />
    </>
  );
}
