import Link from "next/link";
import { notFound } from "next/navigation";
import { getFacilityDetail, getFacilitiesDetailed, getFinishedStock, getSupplierOptions } from "@/lib/queries";
import { getFmt } from "@/lib/fmt-server";
import { qty } from "@/lib/format";
import { PageHeader, Card, SkuAvatar } from "@/components/ui";
import { PrevNextNav, neighbours } from "@/components/PrevNextNav";
import { FacilityEditor } from "@/components/FacilityEditor";
import { DeleteEntity } from "@/components/DeleteEntity";
import { deleteFacility } from "@/app/facilities/actions";
import { facilityTypeLabel } from "@/lib/facility-types";

export const dynamic = "force-dynamic";

export default async function FacilityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, facilities, stock, suppliers, { money }] = await Promise.all([
    getFacilityDetail(id),
    getFacilitiesDetailed(),
    getFinishedStock(),
    getSupplierOptions(),
    getFmt(),
  ]);
  if (!detail) notFound();
  const { facility, usedBy } = detail;
  const nav = neighbours(facilities, id, "/facilities");
  const here = stock.rows.filter((r) => r.facilityId === id);
  const hereValue = here.reduce((s, r) => s + r.value, 0);

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
          supplierId: facility.supplierProfile?.id ?? null,
        }}
        suppliers={suppliers}
      />

      <div className="mt-5">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Finished goods on hand</div>
            {here.length > 0 && <div className="tabular text-[13px] font-semibold text-ink">{money(hereValue)}</div>}
          </div>
          {here.length === 0 ? (
            <p className="text-[12.5px] text-muted">
              No finished stock recorded here. Units land here when a lot produced at this facility is marked finished, and
              leave when you record a movement.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {here.map((r) => (
                <div key={r.productId} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
                  <SkuAvatar code={r.code} size={28} imageUrl={r.imageUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-ink">{r.code}</div>
                    <div className="truncate text-[11px] text-muted">{r.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="tabular text-[13px] font-medium text-ink">{qty(r.units)}</div>
                    <div className="tabular text-[11px] text-muted">{money(r.value)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

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
