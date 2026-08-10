import { PageHeader } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { OrdersFilled } from "@/components/icons";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

/**
 * Orders — the Analytics section's landing. Empty for now: this is where channel orders and the
 * profit tracking built on top of them will live. Gated on "dashboard" (analytics-level visibility)
 * so it needs no new permission resource.
 */
export default async function OrdersPage() {
  await requireView("dashboard");
  return (
    <>
      <PageHeader title="Orders" subtitle="Every sale across your connected channels — coming soon." />
      <EmptyState
        icon={OrdersFilled}
        title="Orders are on the way"
        body="Soon this is where every order from Amazon, Shopify and TikTok lands — and the profit on each one."
      />
    </>
  );
}
