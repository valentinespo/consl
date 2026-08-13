import { PageHeader } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { PnlFilled } from "@/components/icons";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function PnlPage() {
  await requireView("dashboard");
  return (
    <>
      <PageHeader title="P&L" subtitle="Profit and loss, period by period." />
      <EmptyState
        icon={PnlFilled}
        title="Nothing here yet"
        body="The P&L view is on its way — revenue on one side, COGS and expenses on the other."
      />
    </>
  );
}
