import { getTransactionInvoices, getLotOptions, getSupplierNames, getProductImageMap } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { TransactionInvoicesTable } from "@/components/TransactionInvoicesTable";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const [invoices, lots, suppliers, skuImages] = await Promise.all([
    getTransactionInvoices(),
    getLotOptions(),
    getSupplierNames(),
    getProductImageMap(),
  ]);

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={`${invoices.length} invoices. Each fans out into allocation lines — ingredient & other costs flow into each lot's COG.`}
      />
      <TransactionInvoicesTable invoices={invoices} lots={lots} suppliers={suppliers} skuImages={skuImages} showLotColumn />
    </>
  );
}
