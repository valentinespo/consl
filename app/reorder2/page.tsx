import { getReorder2 } from "@/lib/reorder2";
import { getOrgSettings } from "@/lib/settings";
import { getCurrentOrg } from "@/lib/org";
import { PageHeader } from "@/components/ui";
import { Reorder2Dashboard } from "@/components/Reorder2Dashboard";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

/** Reorder 2.0 — the same recommendations, asked per place a product sells from: FBA, your own
 *  facilities, Shopify locations, TikTok warehouses — with moves suggested along the stock routes. */
export default async function Reorder2Page() {
  await requireView("inventory");
  const [data, settings, org] = await Promise.all([getReorder2(), getOrgSettings(), getCurrentOrg().catch(() => null)]);
  let synced: string | null = null;
  if (data.lastSync) {
    const opts = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } as const;
    try {
      synced = data.lastSync.toLocaleString(org?.locale ?? "en-US", { ...opts, timeZone: settings.syncTz });
    } catch {
      synced = data.lastSync.toLocaleString(org?.locale ?? "en-US", opts);
    }
  }
  return (
    <>
      <PageHeader title="Reorder 2.0" subtitle="Every place a product sells from, on its own line — what to move where, what to expedite, what to order.">
        <span className="text-[11.5px] text-muted">{synced ? `Updated ${synced}` : ""}</span>
      </PageHeader>
      <Reorder2Dashboard
        rows={data.rows}
        places={data.places}
        routes={data.routes}
        routesSaved={data.routesSaved}
        defaults={data.defaults}
        sortMode={data.sortMode}
        nowMs={data.nowMs}
      />
    </>
  );
}
