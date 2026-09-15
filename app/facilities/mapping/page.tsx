import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireView } from "@/lib/membership";
import { prisma } from "@/lib/prisma";
import { ChevronLeft } from "@/components/icons";
import { distinctFacilityNames } from "@/lib/order-metrics";
import { facilityStockSources, readChannelStock } from "@/lib/channel-stock";
import { FacilityMappingClient, type MappingData } from "@/components/FacilityMappingClient";

export const dynamic = "force-dynamic";

/**
 * Map facilities — every place a connected channel ships from, and which consl facility it is.
 * Amazon FBA/AWD, Shopify locations and TikTok warehouses map themselves; a merchant-fulfilled
 * Amazon ship-from address is the one row that needs a person. A Shopify location or TikTok
 * warehouse that is really one of the company's other facilities can be pointed at it ("same
 * place as…"), and a facility two platforms then report picks which count it uses.
 */
export default async function FacilityMappingPage() {
  await requireView("facilities");
  const [facilities, places, shipFromCounts, sources, stock, products] = await Promise.all([
    prisma.facility.findMany({ where: { inactive: false }, select: { id: true, code: true, name: true, type: true, channel: true, externalId: true }, orderBy: { name: "asc" } }),
    prisma.channelLocation.findMany({ include: { facility: { select: { id: true, name: true, channel: true } } }, orderBy: [{ channel: "asc" }, { name: "asc" }] }),
    prisma.salesOrder.groupBy({ by: ["shipFromKey"], where: { channel: "AMAZON", shipFromKey: { not: null } }, _count: true }),
    facilityStockSources(),
    readChannelStock(),
    prisma.product.findMany({ select: { id: true, code: true } }),
  ]);
  const orders = new Map(shipFromCounts.map((r) => [r.shipFromKey as string, r._count]));
  const fba = facilities.find((f) => f.channel === "AMAZON_FBA") ?? null;
  const labelled = distinctFacilityNames(facilities);
  const labelOf = new Map(labelled.map((f) => [f.id, f.label]));
  const named = (f: { id: string; name: string } | null) => (f ? { id: f.id, name: labelOf.get(f.id) ?? f.name } : null);
  const codeOf = new Map(products.map((p) => [p.id, p.code]));
  const data: MappingData = {
    amazonManaged: facilities.filter((f) => f.channel?.startsWith("AMAZON")).map((f) => ({ id: f.id, name: f.name, kind: f.channel === "AMAZON_AWD" ? "AWD" : "FBA" })),
    shipFrom: places
      .filter((p) => p.channel === "AMAZON")
      .map((p) => ({ id: p.id, key: p.externalId, label: p.name, facility: named(p.facility), orders: orders.get(p.externalId) ?? 0, active: p.active })),
    // A place that is inactive, has no facility and isn't Amazon's mirror (a TikTok return
    // warehouse, a location deactivated before it ever had a facility) has nothing to show.
    channelPlaces: places
      .filter((p) => p.channel !== "AMAZON" && (p.facility || p.amazonMirror || p.active))
      .map((p) => ({
        id: p.id,
        channel: p.channel,
        label: p.name,
        active: p.active,
        facility: p.amazonMirror && !p.facility ? named(fba) : named(p.facility),
        amazonMirror: p.amazonMirror,
        manual: p.mappedManually,
        // "Own facility again" was clicked but the platform couldn't be read that minute: the
        // place still counts at the merged facility until the next places sync gives it its own.
        awaitingOwn: !p.mappedManually && !p.amazonMirror && !!p.facility && p.facility.channel !== p.channel,
        // The facility the sync made for this very place — never a "same place as…" choice.
        ownFacilityId: facilities.find((f) => f.channel === p.channel && f.externalId === p.externalId)?.id ?? null,
      })),
    candidates: labelled.filter((f) => !f.channel?.startsWith("AMAZON")).map((f) => ({ id: f.id, name: f.label, code: f.code, type: f.type })),
    // Facilities more than one platform reports: which count is used, and where the other differs.
    stockSources: [...sources.values()]
      .filter((s) => s.platforms.length > 1 && s.source)
      .map((s) => ({
        facilityId: s.facilityId,
        platforms: s.platforms,
        source: s.source as string,
        disagreements: stock.disagreements
          .filter((d) => d.facilityId === s.facilityId)
          .map((d) => ({ code: codeOf.get(d.productId) ?? "?", units: d.units, other: d.other, otherUnits: d.otherUnits })),
      })),
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
