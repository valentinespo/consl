import { getRestock } from "@/lib/restock";
import { PageHeader } from "@/components/ui";
import { InventoryNav } from "@/components/InventoryNav";
import { RestockDashboard } from "@/components/RestockDashboard";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const { rows, totals, lastSync, defaults } = await getRestock();
  const synced = lastSync
    ? lastSync.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : null;
  return (
    <>
      <PageHeader title="Inventory" subtitle="Live FBA stock + production + raw materials, with restock recommendations." />
      <InventoryNav />
      <RestockDashboard rows={rows} totals={totals} lastSync={synced} defaults={defaults} nowMs={Date.now()} />
    </>
  );
}
