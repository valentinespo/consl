import { getPurchaseInvoicesByMaterial, getPurchaseFormOptions } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { MaterialPurchaseInvoices } from "@/components/MaterialPurchaseInvoices";

export const dynamic = "force-dynamic";

export default async function PurchasesPage() {
  const [groups, options] = await Promise.all([getPurchaseInvoicesByMaterial(), getPurchaseFormOptions()]);
  const purchaseOptions = { facilities: options.facilities, products: options.products, suppliers: options.suppliers };

  return (
    <>
      <PageHeader
        title="Purchases"
        subtitle="Raw material invoices by type. Each invoice covers one material and feeds the FIFO inventory pools."
      />
      <div className="space-y-8">
        {groups.map((g) => (
          <MaterialPurchaseInvoices key={g.material.id} group={g} options={purchaseOptions} />
        ))}
      </div>
    </>
  );
}
