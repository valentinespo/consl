import { getTransactionInvoices, getLotOptions, getSupplierNames, getProductImageMap, getCategoriesInUse } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { TransactionInvoicesTable } from "@/components/TransactionInvoicesTable";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  await requireView("transactions");
  const [invoices, lots, suppliers, skuImages, categories] = await Promise.all([
    getTransactionInvoices(),
    getLotOptions(),
    getSupplierNames(),
    getProductImageMap(),
    getCategoriesInUse(),
  ]);

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={`${invoices.length} invoices. Each fans out into allocation lines — costs flow into each lot's COG by category.`}
      />
      <TransactionInvoicesTable invoices={invoices} lots={lots} suppliers={suppliers} categories={categories} skuImages={skuImages} showLotColumn />
    </>
  );
}
