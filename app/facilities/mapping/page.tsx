import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireView } from "@/lib/membership";
import { prisma } from "@/lib/prisma";
import { ChevronLeft } from "@/components/icons";
import { FacilityMappingClient, type MappingData } from "@/components/FacilityMappingClient";

export const dynamic = "force-dynamic";

/**
 * Map facilities — every place a connected channel ships from, and which consl facility it is.
 * Amazon FBA/AWD, Shopify locations and TikTok warehouses map themselves; a merchant-fulfilled
 * Amazon ship-from address is the one row that needs a person.
 */
export default async function FacilityMappingPage() {
  await requireView("facilities");
  const [facilities, places, shipFromCounts] = await Promise.all([
    prisma.facility.findMany({ where: { inactive: false }, select: { id: true, code: true, name: true, type: true, channel: true }, orderBy: { name: "asc" } }),
    prisma.channelLocation.findMany({ include: { facility: { select: { id: true, name: true } } }, orderBy: [{ channel: "asc" }, { name: "asc" }] }),
    prisma.salesOrder.groupBy({ by: ["shipFromKey"], where: { channel: "AMAZON", shipFromKey: { not: null } }, _count: true }),
  ]);
  const orders = new Map(shipFromCounts.map((r) => [r.shipFromKey as string, r._count]));
  const fba = facilities.find((f) => f.channel === "AMAZON_FBA") ?? null;
  const data: MappingData = {
    amazonManaged: facilities.filter((f) => f.channel?.startsWith("AMAZON")).map((f) => ({ id: f.id, name: f.name, kind: f.channel === "AMAZON_AWD" ? "AWD" : "FBA" })),
    shipFrom: places
      .filter((p) => p.channel === "AMAZON")
      .map((p) => ({ id: p.id, key: p.externalId, label: p.name, facility: p.facility, orders: orders.get(p.externalId) ?? 0, active: p.active })),
    channelPlaces: places
      .filter((p) => p.channel !== "AMAZON")
      .map((p) => ({ id: p.id, channel: p.channel, label: p.name, active: p.active, facility: p.amazonMirror && !p.facility ? fba : p.facility })),
    candidates: facilities.filter((f) => !f.channel?.startsWith("AMAZON")).map((f) => ({ id: f.id, name: f.name, code: f.code, type: f.type })),
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
