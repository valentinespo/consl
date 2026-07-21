import { getLots, getPurchaseFormOptions } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { LotsTable, type LotRow } from "@/components/LotsTable";
import { NewLotButton } from "@/components/NewLotButton";

export const dynamic = "force-dynamic";

export default async function LotsPage() {
  const [lots, options] = await Promise.all([getLots(), getPurchaseFormOptions()]);
  const rows: LotRow[] = lots.map((l) => ({
    id: l.id,
    lotNr: l.lotNr,
    poNumber: l.poNumber,
    poDate: l.poDate ? l.poDate.toISOString() : null,
    facility: l.facility,
    status: l.status,
    finishedAt: l.finishedAt ? l.finishedAt.toISOString() : null,
    skus: l.skus,
    lines: l.lines,
    units: l.units,
    cogTotal: l.cogTotal,
    avgCogPerUnit: l.avgCogPerUnit,
    txnCount: l.txnCount,
  }));
  const facilities = [...new Set(lots.map((l) => l.facility))].sort();

  return (
    <>
      <PageHeader title="Production Lots" subtitle="Every production batch, with live FIFO-costed COG. Open a lot for its cost breakdown and transactions.">
        <NewLotButton facilities={options.facilities} products={options.products} />
      </PageHeader>
      <LotsTable lots={rows} facilities={facilities} />
    </>
  );
}
