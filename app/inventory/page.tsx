import { getRestock } from "@/lib/restock";
import { PageHeader } from "@/components/ui";
import { InventoryNav } from "@/components/InventoryNav";
import { RestockDashboard } from "@/components/RestockDashboard";
import { SyncAmazonButton } from "@/components/SyncAmazonButton";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const { rows, totals, lastSync, defaults, sortMode } = await getRestock();
  const synced = lastSync
    ? lastSync.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;
  return (
    <>
      <PageHeader title="Inventory" subtitle="Live FBA stock + production + raw materials, with restock recommendations." />
      <InventoryNav right={<SyncAmazonButton lastSync={synced} />} />
      <RestockDashboard rows={rows} totals={totals} defaults={defaults} sortMode={sortMode} nowMs={Date.now()} />
    </>
  );
}
