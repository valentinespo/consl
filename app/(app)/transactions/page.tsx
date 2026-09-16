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

  const drafts = invoices.filter((inv) => inv.draft).length;
  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={`${invoices.length - drafts} invoices${drafts ? ` and ${drafts} draft${drafts === 1 ? "" : "s"}` : ""}. Each fans out into allocation lines — costs flow into each lot's COG by category.`}
      />
      <TransactionInvoicesTable invoices={invoices} lots={lots} suppliers={suppliers} categories={categories} skuImages={skuImages} showLotColumn />
    </>
  );
}
