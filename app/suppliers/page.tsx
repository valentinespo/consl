import { getSuppliers, getFacilities } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { SupplierCard } from "@/components/SupplierCard";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const [suppliers, facilities] = await Promise.all([getSuppliers(), getFacilities()]);

  return (
    <>
      <PageHeader title="Suppliers" subtitle="Vendor profiles and the activity tied to each. Click the pencil to edit contact info." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {suppliers.map((s) => (
          <SupplierCard key={s.id} supplier={s} facilities={facilities} />
        ))}
      </div>
    </>
  );
}
