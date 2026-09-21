import { PageHeader } from "@/components/ui";
import { requireView } from "@/lib/membership";
import { getOrgSettings } from "@/lib/settings";
import { loadLtv } from "@/lib/ltv-data";
import { LtvClient } from "@/components/LtvClient";

export const dynamic = "force-dynamic";

/**
 * LTV — what a customer is worth over time, by the month they first bought: revenue and real
 * profit per customer at fixed ages, repeat rate, what a new customer cost in ads and how long
 * they took to pay it back. Shopify first: it is the channel that says who bought.
 */
export default async function LtvPage() {
  await requireView("dashboard");
  const settings = await getOrgSettings();
  const data = await loadLtv(settings.syncTz);
  return (
    <>
      <PageHeader title="LTV" subtitle="What a customer is worth over time, by the month they first bought." />
      <LtvClient data={data} />
    </>
  );
}
