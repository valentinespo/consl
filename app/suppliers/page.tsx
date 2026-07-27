import { Building2 } from "@/components/icons";
import { getSuppliers } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { SupplierCard } from "@/components/SupplierCard";
import { NewSupplierButton } from "@/components/NewSupplierButton";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const suppliers = await getSuppliers();

  return (
    <>
      <PageHeader title="Suppliers" subtitle="The vendors you buy from. Open one to edit its contact details.">
        {suppliers.length > 0 && <NewSupplierButton />}
      </PageHeader>

      {suppliers.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No suppliers yet"
          body="Suppliers are the companies you buy raw materials and services from. Add one here, or they'll be created automatically the first time you log an invoice."
        >
          <NewSupplierButton />
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {suppliers.map((s) => (
            <SupplierCard key={s.id} supplier={s} />
          ))}
        </div>
      )}
    </>
  );
}
