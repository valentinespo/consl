import { getPurchaseInvoicesByMaterial, getPurchaseFormOptions } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { Package } from "@/components/icons";
import Link from "next/link";
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
      {groups.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No raw materials yet"
          body="Purchases are logged against a raw material. Create your materials in the Catalog first, then come back here to record what you bought."
        >
          <Link
            href="/catalog"
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90"
          >
            Go to Catalog
          </Link>
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <MaterialPurchaseInvoices key={g.material.id} group={g} options={purchaseOptions} />
          ))}
        </div>
      )}
    </>
  );
}
