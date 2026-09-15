import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireView } from "@/lib/membership";
import { ChevronLeft } from "@/components/icons";
import { loadMappingData } from "@/lib/facility-mapping";
import { FacilityMappingClient } from "@/components/FacilityMappingClient";

export const dynamic = "force-dynamic";

/**
 * Map facilities — every place a connected channel ships from, and which consl facility it is.
 * Amazon FBA/AWD are managed; a merchant-fulfilled Amazon ship-from address needs a person; a
 * Shopify location or TikTok warehouse maps itself but a person can say what it really is: its
 * own facility, the same place as another facility, Amazon MCF, or nothing consl should track.
 */
export default async function FacilityMappingPage() {
  await requireView("facilities");
  const data = await loadMappingData();
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
