import { getRestock } from "@/lib/restock";
import { getOrgSettings } from "@/lib/settings";
import { getCurrentOrg } from "@/lib/org";
import { PageHeader } from "@/components/ui";
import { InventoryNav } from "@/components/InventoryNav";
import { RestockDashboard } from "@/components/RestockDashboard";
import { SyncAmazonButton } from "@/components/SyncAmazonButton";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  await requireView("inventory");
  const [{ rows, totals, lastSync, defaults, sortMode }, settings, org] = await Promise.all([
    getRestock(),
    getOrgSettings(),
    getCurrentOrg().catch(() => null),
  ]);
  // "Updated …" is a wall-clock statement, so it must follow the timezone chosen in Settings —
  // the server's own clock is UTC on Railway and whatever the laptop says in dev.
  let synced: string | null = null;
  if (lastSync) {
    const opts = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } as const;
    try {
      synced = lastSync.toLocaleString(org?.locale ?? "en-US", { ...opts, timeZone: settings.syncTz });
    } catch {
      synced = lastSync.toLocaleString(org?.locale ?? "en-US", opts); // unknown zone — server clock
    }
  }
  return (
    <>
      <PageHeader title="Inventory" subtitle="Live FBA stock + production + raw materials, with restock recommendations." />
      <InventoryNav right={<SyncAmazonButton lastSync={synced} />} />
      <RestockDashboard rows={rows} totals={totals} defaults={defaults} sortMode={sortMode} nowMs={Date.now()} />
    </>
  );
}
