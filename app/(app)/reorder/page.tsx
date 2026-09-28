import { getRestock } from "@/lib/restock";
import { prisma } from "@/lib/prisma";
import { getOrgSettings } from "@/lib/settings";
import { getCurrentOrg } from "@/lib/org";
import { PageHeader } from "@/components/ui";
import { RestockDashboard } from "@/components/RestockDashboard";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

/** Restock recommendations — what to reship to Amazon and what POs to place. Formerly the
 *  Inventory "Overview" tab; now its own top-level section beside Inventory. */
export default async function ReorderPage() {
  await requireView("inventory");
  const [{ rows: allRows, lastSync, defaults, sortMode }, settings, org, archivedProducts] = await Promise.all([
    getRestock(),
    getOrgSettings(),
    getCurrentOrg().catch(() => null),
    prisma.product.findMany({ where: { archivedAt: { not: null } }, select: { id: true } }),
  ]);
  // Archived products are left off Reorder; their stock and sales still count everywhere else.
  const archived = new Set(archivedProducts.map((p) => p.id));
  const rows = allRows.filter((r) => !archived.has(r.id));
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
      <PageHeader title="Reorder" subtitle="Restock recommendations — what to reship to Amazon and what to reorder.">
        {/* No sync button — stock and sales refresh themselves (always-live rule). */}
        <span className="text-[11.5px] text-muted">{synced ? `Updated ${synced}` : ""}</span>
      </PageHeader>
      <RestockDashboard rows={rows} defaults={defaults} sortMode={sortMode} nowMs={Date.now()} />
    </>
  );
}
