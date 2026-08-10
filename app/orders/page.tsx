import { PageHeader } from "@/components/ui";
import { requireView } from "@/lib/membership";
import { getOrdersOverview } from "@/lib/order-metrics";
import { prisma } from "@/lib/prisma";
import { OrdersClient } from "@/components/OrdersClient";

export const dynamic = "force-dynamic";

/**
 * Orders — the Analytics section's landing and the home for profit tracking to come. Shows every
 * order pulled from the connected channels, with the double-count guard for channels that mirror
 * into Shopify. Gated on "dashboard" (analytics-level visibility).
 */
export default async function OrdersPage() {
  await requireView("dashboard");
  const conns = await prisma.integration.findMany({
    where: { status: "connected", provider: { in: ["amazon", "shopify", "tiktok"] } },
    select: { provider: true },
  });
  const connectedChannels = conns.map((c) => c.provider.toUpperCase());
  const overview = await getOrdersOverview(connectedChannels);
  return (
    <>
      <PageHeader title="Orders" subtitle="Every sale across your connected channels." />
      <OrdersClient overview={overview} canImport={conns.length > 0} />
    </>
  );
}
