import { getPurchaseOrders, getPoFormOptions } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { PurchaseOrdersView } from "@/components/PurchaseOrdersView";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage() {
  await requireView("purchaseOrders");
  const [pos, options] = await Promise.all([getPurchaseOrders(), getPoFormOptions()]);
  const todayISO = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        subtitle="Generate branded PO PDFs for the facilities that make your product. Creating a PO also opens its production lot."
      />
      <PurchaseOrdersView
        pos={pos}
        facilities={options.facilities}
        products={options.products}
        descSeeds={options.descSeeds}
        nextLotNr={options.nextLotNr}
        todayISO={todayISO}
      />
    </>
  );
}
