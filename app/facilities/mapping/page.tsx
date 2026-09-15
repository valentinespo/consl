import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireView } from "@/lib/membership";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { ChevronLeft } from "@/components/icons";
import { distinctFacilityNames } from "@/lib/order-metrics";
import { facilityStockSources } from "@/lib/channel-stock";
import { FacilityMappingClient, type MappingData, type PlaceMode } from "@/components/FacilityMappingClient";

export const dynamic = "force-dynamic";

/**
 * Map facilities — every place a connected channel ships from, and which consl facility it is.
 * Amazon FBA/AWD are managed; a merchant-fulfilled Amazon ship-from address needs a person; a
 * Shopify location or TikTok warehouse maps itself but a person can say what it really is: its
 * own facility, the same place as another facility, Amazon MCF, or nothing consl should track.
 */
export default async function FacilityMappingPage() {
  await requireView("facilities");
  const orgId = await getCurrentOrgId();
  const [facilities, places, shipFromCounts, sources, tiktokOrders, shopifyOrders] = await Promise.all([
    prisma.facility.findMany({ select: { id: true, code: true, name: true, type: true, channel: true, externalId: true, inactive: true }, orderBy: { name: "asc" } }),
    prisma.channelLocation.findMany({ include: { facility: { select: { id: true, name: true, channel: true } } }, orderBy: [{ channel: "asc" }, { name: "asc" }] }),
    prisma.salesOrder.groupBy({ by: ["shipFromKey"], where: { channel: "AMAZON", shipFromKey: { not: null } }, _count: true }),
    facilityStockSources(),
    // Orders per place, from what each platform recorded on the order itself — so the dialog can
    // say how many orders a choice touches.
    prisma.$queryRaw<{ key: string | null; n: number }[]>`
      SELECT so."sourceData"->>'warehouse_id' AS key, COUNT(*)::int AS n
      FROM "SalesOrder" so WHERE so."orgId" = ${orgId} AND so.channel = 'TIKTOK' GROUP BY 1`,
    prisma.$queryRaw<{ key: string | null; n: number }[]>`
      SELECT f->'location'->>'id' AS key, COUNT(DISTINCT so.id)::int AS n
      FROM "SalesOrder" so, jsonb_array_elements(so."sourceData"->'fulfillments') f
      WHERE so."orgId" = ${orgId} AND so.channel = 'SHOPIFY' AND jsonb_typeof(so."sourceData"->'fulfillments') = 'array' GROUP BY 1`,
  ]);
  const ordersAt = new Map<string, number>();
  for (const r of tiktokOrders) if (r.key) ordersAt.set(`TIKTOK|${r.key}`, r.n);
  for (const r of shopifyOrders) if (r.key) ordersAt.set(`SHOPIFY|${r.key}`, r.n);
  const orders = new Map(shipFromCounts.map((r) => [r.shipFromKey as string, r._count]));
  const active = facilities.filter((f) => !f.inactive);
  const fba = active.find((f) => f.channel === "AMAZON_FBA") ?? null;
  const labelled = distinctFacilityNames(active);
  const labelOf = new Map(labelled.map((f) => [f.id, f.label]));
  const named = (f: { id: string; name: string; channel?: string | null } | null) => (f ? { id: f.id, name: labelOf.get(f.id) ?? f.name, channel: f.channel ?? null } : null);
  const data: MappingData = {
    amazonManaged: active.filter((f) => f.channel?.startsWith("AMAZON")).map((f) => ({ id: f.id, name: f.name, kind: f.channel === "AMAZON_AWD" ? "AWD" : "FBA" })),
    fbaName: fba?.name ?? null,
    shipFrom: places
      .filter((p) => p.channel === "AMAZON")
      .map((p) => ({ id: p.id, key: p.externalId, label: p.name, facility: named(p.facility), orders: orders.get(p.externalId) ?? 0, active: p.active })),
    // A place that is inactive, has no facility, isn't Amazon's mirror and was never decided on (a
    // TikTok return warehouse, a location deactivated before it ever had a facility) has nothing to show.
    channelPlaces: places
      .filter((p) => p.channel !== "AMAZON" && (p.facility || p.amazonMirror || p.active || p.mode !== "auto"))
      .map((p) => {
        const mode = p.mode as PlaceMode;
        const own = facilities.find((f) => f.channel === p.channel && f.externalId === p.externalId) ?? null;
        const autoMcf = mode === "auto" && p.amazonMirror && !p.facility;
        const target = p.facility;
        const stock =
          mode === "merged" && target && (target.channel === "SHOPIFY" || target.channel === "TIKTOK") && target.channel !== p.channel
            ? { facilityId: target.id, platforms: [target.channel, p.channel], source: sources.get(target.id)?.source ?? target.channel }
            : null;
        return {
          id: p.id,
          channel: p.channel,
          label: p.name,
          active: p.active,
          mode,
          autoMcf,
          facility: mode === "mcf" || autoMcf ? named(fba) : named(target),
          ownFacilityId: own?.id ?? null,
          ownActive: !!own && !own.inactive,
          // Places another platform merged into this one's facility — they follow its decision.
          mergedHere: own ? places.filter((q) => q.id !== p.id && q.mode === "merged" && q.facilityId === own.id).map((q) => q.name) : [],
          reportedUnits: p.reportedUnits,
          reportedSkus: p.reportedSkus,
          orders: ordersAt.get(`${p.channel}|${p.externalId}`) ?? 0,
          stock,
        };
      }),
    candidates: labelled.filter((f) => !f.channel?.startsWith("AMAZON")).map((f) => ({ id: f.id, name: f.label, code: f.code, type: f.type, channel: f.channel })),
  };
  return (
    <>
      <PageHeader title="Map facilities" subtitle="Every place your channels ship from, and which facility in consl it is.">
        <Link href="/facilities" className="inline-flex items-center gap-1 rounded-lg border border-border bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-panel-2">
          <ChevronLeft size={13} /> Facilities
        </Link>
      </PageHeader>
      <FacilityMappingClient data={data} />
    </>
  );
}
