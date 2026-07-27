import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupplierDetail, getSuppliers, getFacilities } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { PrevNextNav, neighbours } from "@/components/PrevNextNav";
import { SupplierEditor } from "@/components/SupplierEditor";
import { DeleteEntity } from "@/components/DeleteEntity";
import { deleteSupplier } from "@/app/suppliers/actions";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireView("suppliers");
  const { id } = await params;
  const [detail, suppliers, facilities] = await Promise.all([getSupplierDetail(id), getSuppliers(), getFacilities()]);
  if (!detail) notFound();
  const { supplier, usedBy } = detail;
  const nav = neighbours(suppliers, id, "/suppliers");

  return (
    <>
      <Link href="/suppliers" className="mb-3 inline-block text-[12.5px] font-medium text-muted hover:text-ink-soft">
        ← Suppliers
      </Link>
      <PageHeader title={supplier.name} subtitle={supplier.facility ? `Also your ${supplier.facility.code} facility` : "Vendor"}>
        <PrevNextNav {...nav} />
      </PageHeader>

      <SupplierEditor
        supplier={{
          id: supplier.id,
          name: supplier.name,
          photoUrl: supplier.photoUrl,
          email: supplier.email,
          phone: supplier.phone,
          address: supplier.address,
          notes: supplier.notes,
          facilityId: supplier.facilityId,
        }}
        facilities={facilities}
      />

      <DeleteEntity
        kind="supplier"
        name={supplier.name}
        usedBy={usedBy}
        onDelete={deleteSupplier.bind(null, supplier.id)}
        redirectTo="/suppliers"
        resource="suppliers"
      />
    </>
  );
}
