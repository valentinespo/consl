import Link from "next/link";
import { notFound } from "next/navigation";
import { getFacilityDetail, getFacilitiesDetailed } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { PrevNextNav, neighbours } from "@/components/PrevNextNav";
import { FacilityEditor } from "@/components/FacilityEditor";
import { DeleteEntity } from "@/components/DeleteEntity";
import { deleteFacility } from "@/app/facilities/actions";
import { facilityTypeLabel } from "@/lib/facility-types";

export const dynamic = "force-dynamic";

export default async function FacilityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, facilities] = await Promise.all([getFacilityDetail(id), getFacilitiesDetailed()]);
  if (!detail) notFound();
  const { facility, usedBy } = detail;
  const nav = neighbours(facilities, id, "/facilities");

  return (
    <>
      <Link href="/facilities" className="mb-3 inline-block text-[12.5px] font-medium text-muted hover:text-ink-soft">
        ← Facilities
      </Link>
      <PageHeader title={facility.name} subtitle={`${facilityTypeLabel(facility.type)} · ${facility.code}`}>
        <PrevNextNav {...nav} />
      </PageHeader>

      <FacilityEditor
        facility={{
          id: facility.id,
          code: facility.code,
          name: facility.name,
          type: facility.type,
          legalName: facility.legalName,
          address: facility.address,
          notes: facility.notes,
        }}
      />

      <DeleteEntity
        kind="facility"
        name={facility.name}
        usedBy={usedBy}
        onDelete={deleteFacility.bind(null, facility.id)}
        redirectTo="/facilities"
      />
    </>
  );
}
