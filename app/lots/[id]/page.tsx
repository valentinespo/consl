import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getLot,
  getLotOptions,
  getSupplierNames,
  getMaterialTypes,
  getFacilities,
  getTransactionInvoices,
  getProductImageMap,
  getProducts,
  getCategoriesInUse,
} from "@/lib/queries";
import { getFmt } from "@/lib/fmt-server";
import { buildCostChips } from "@/lib/lot-costs";
import { PageHeader } from "@/components/ui";
import { PrevNextNav, neighbours } from "@/components/PrevNextNav";
import { TransactionInvoicesTable } from "@/components/TransactionInvoicesTable";
import { LotEditor, type EditorLine } from "@/components/LotEditor";
import { DocumentList } from "@/components/DocumentList";
import { DeleteLot } from "@/components/DeleteLot";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function LotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireView("lots");
  const { id } = await params;
  const [lot, lotOptions, suppliers, materialTypes, facilities, invoices, skuImages, products, categories] = await Promise.all([
    getLot(id),
    getLotOptions(),
    getSupplierNames(),
    getMaterialTypes(),
    getFacilities(),
    getTransactionInvoices(id),
    getProductImageMap(),
    getProducts(),
    getCategoriesInUse(),
  ]);
  if (!lot) notFound();
  const { qty } = await getFmt();

  const totalCog = lot.lines.reduce((s, l) => s + l.cogPerUnit * l.units, 0);

  // Per-SKU shortfalls for the top banner.
  const shortLineDetails: { sku: string; shortBy: number; materialCode: string }[] = [];
  for (const ln of lot.lines)
    for (const s of JSON.parse(ln.shortfallsJson) as { materialCode: string; shortBy: number }[])
      shortLineDetails.push({ sku: ln.product.code, shortBy: s.shortBy, materialCode: s.materialCode });
  const hasShortfall = shortLineDetails.length > 0;

  const matName = (code: string) => materialTypes.find((m) => m.code === code)?.name ?? code;
  const initialLines: EditorLine[] = lot.lines.map((ln) => ({
    id: ln.id,
    productId: ln.productId,
    code: ln.product.code,
    name: ln.product.name,
    imageUrl: ln.product.imageUrl,
    units: ln.units,
    materials: ln.materials.map((m) => ({ materialTypeId: m.materialTypeId, perUnit: m.perUnit })),
    costs: buildCostChips(ln.materialCostsJson, ln.transactionCostsJson, ln.shortfallsJson, matName),
    cogPerUnit: ln.cogPerUnit,
    shortfalls: JSON.parse(ln.shortfallsJson),
  }));

  // How many transaction lines are assigned to each SKU of this lot (become unassigned if removed).
  const skuTxnCounts: Record<string, number> = {};
  for (const inv of invoices)
    for (const line of inv.lines)
      if (line.lotId === lot.id && line.sku && line.appliesToCog)
        skuTxnCounts[line.sku] = (skuTxnCounts[line.sku] ?? 0) + 1;

  return (
    <>
      <Link href="/lots" className="mb-3 inline-block text-[12.5px] font-medium text-muted hover:text-ink-soft">
        ← Production Lots
      </Link>
      <PageHeader title={`Lot #${lot.lotNr}`} subtitle={lot.poNumber ? `PO ${lot.poNumber}` : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          {/* LotEditor portals its Production + Payment pill-dropdowns here, so they stage into
              the form's single save bar. PO date/facility live once, as the form fields below. */}
          <span id="lot-status-slot" className="flex items-center gap-2" />
          {/* Same list order as the Production Lots page, so the arrows walk it the way it reads. */}
          <PrevNextNav {...neighbours(lotOptions, id, "/lots")} />
        </div>
      </PageHeader>

      {hasShortfall && (
        <div className="mb-5 flex items-start gap-2.5 rounded-[var(--radius-card)] border border-[#e7cfc8] bg-[#fbeae6] px-4 py-3">
          <span className="text-[16px] leading-none">⚠️</span>
          <div className="text-[12.5px] text-negative">
            <span className="font-semibold">Not enough material purchased for this lot.</span>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {shortLineDetails.map((s, i) => (
                <li key={i}>
                  <span className="font-medium">{s.sku}</span> needs {qty(s.shortBy)} more units of {matName(s.materialCode)}
                </li>
              ))}
            </ul>
            <span className="mt-1 block">COG below is incomplete until the stock is purchased.</span>
          </div>
        </div>
      )}

      <div className="mt-6">
        <LotEditor
          key={lot.updatedAt.toISOString()}
          lotId={lot.id}
          initial={{
            poNumber: lot.poNumber,
            poDateISO: lot.poDate ? lot.poDate.toISOString().slice(0, 10) : null,
            facilityId: lot.facilityId,
            status: lot.status,
            paymentStatus: lot.paymentStatus === "PAID" ? "PAID" : "DUE",
            finishedAtISO: lot.finishedAt ? lot.finishedAt.toISOString().slice(0, 10) : null,
            expiryISO: lot.expiryAt ? lot.expiryAt.toISOString().slice(0, 10) : null,
            batchNr: lot.batchNr,
            notes: lot.notes,
          }}
          initialLines={initialLines}
          facilities={facilities}
          products={products.map((p) => ({ id: p.id, code: p.code, name: p.name, imageUrl: p.imageUrl }))}
          materialTypes={materialTypes}
          skuTxnCounts={skuTxnCounts}
          totalCog={totalCog}
        />
      </div>

      <div className="mt-8 max-w-2xl">
        <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Documents (COA / BOL)</div>
        <DocumentList
          parent="lot"
          parentId={lot.id}
          documents={lot.documents.map((d) => ({ id: d.id, label: d.label, fileUrl: d.fileUrl, fileName: d.fileName }))}
          quickLabels={["COA", "BOL"]}
          showLabelField
        />
      </div>

      <div className="mt-10">
        <h2 className="mb-3 text-[15px] font-semibold text-ink-soft">Assigned transactions</h2>
        <TransactionInvoicesTable
          invoices={invoices}
          lots={lotOptions}
          suppliers={suppliers}
          categories={categories}
          skuImages={skuImages}
          showLotColumn={false}
          defaultLotId={lot.id}
        />
      </div>

      <DeleteLot lotId={lot.id} lotNr={lot.lotNr} />
    </>
  );
}
