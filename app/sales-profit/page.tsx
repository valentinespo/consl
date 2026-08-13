import { PageHeader } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { SalesProfitFilled } from "@/components/icons";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function SalesProfitPage() {
  await requireView("dashboard");
  return (
    <>
      <PageHeader title="Sales & Profit" subtitle="Revenue, costs and margin across your channels." />
      <EmptyState
        icon={SalesProfitFilled}
        title="Nothing here yet"
        body="Sales and profit tracking is on its way — it'll build on the orders and FIFO costs consl already knows."
      />
    </>
  );
}
