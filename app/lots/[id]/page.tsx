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
} from "@/lib/queries";
import { money, qty, date } from "@/lib/format";
import { PageHeader, Pill, FacilityTag } from "@/components/ui";
import { TransactionInvoicesTable } from "@/components/TransactionInvoicesTable";
import { LotEditor, type EditorLine } from "@/components/LotEditor";
import { LotDocuments } from "@/components/LotDocuments";
import { DeleteLot } from "@/components/DeleteLot";

export const dynamic = "force-dynamic";

export default async function LotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lot, lotOptions, suppliers, materialTypes, facilities, invoices, skuImages, products] = await Promise.all([
    getLot(id),
    getLotOptions(),
    getSupplierNames(),
    getMaterialTypes(),
    getFacilities(),
    getTransactionInvoices(id),
    getProductImageMap(),
    getProducts(),
  ]);
  if (!lot) notFound();

  const totalUnits = lot.lines.reduce((s, l) => s + l.units, 0);
  const totalCog = lot.lines.reduce((s, l) => s + l.cogPerUnit * l.units, 0);

  // Per-SKU shortfalls for the top banner.
  const shortLineDetails: { sku: string; shortBy: number; materialCode: string }[] = [];
  for (const ln of lot.lines)
    for (const s of JSON.parse(ln.shortfallsJson) as { materialCode: string; shortBy: number }[])
      shortLineDetails.push({ sku: ln.product.code, shortBy: s.shortBy, materialCode: s.materialCode });
  const hasShortfall = shortLineDetails.length > 0;

  const initialLines: EditorLine[] = lot.lines.map((ln) => ({
    id: ln.id,
    productId: ln.productId,
    code: ln.product.code,
    name: ln.product.name,
    imageUrl: ln.product.imageUrl,
    units: ln.units,
    materials: ln.materials.map((m) => ({ materialTypeId: m.materialTypeId, perUnit: m.perUnit })),
    tea: ln.teaCostPerUnit,
    teabag: ln.teabagCostPerUnit,
    pouch: ln.pouchCostPerUnit,
    other: ln.otherCostPerUnit,
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
        <div className="flex items-center gap-2">
          <FacilityTag code={lot.facility.code} />
          <Pill kind={lot.status}>{lot.status === "IN_PRODUCTION" ? "In production" : "Finished"}</Pill>
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Meta label="PO date" value={date(lot.poDate)} />
        <Meta label="Facility" value={lot.facility.name} />
        <Meta label="Total units" value={qty(totalUnits)} />
        <Meta label="Total COG" value={money(totalCog, 2)} accent={!hasShortfall} />
      </div>

      {hasShortfall && (
        <div className="mt-5 flex items-start gap-2.5 rounded-[var(--radius-card)] border border-[#e7cfc8] bg-[#fbeae6] px-4 py-3">
          <span className="text-[16px] leading-none">⚠️</span>
          <div className="text-[12.5px] text-negative">
            <span className="font-semibold">Not enough material purchased for this lot.</span>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {shortLineDetails.map((s, i) => (
                <li key={i}>
                  <span className="font-medium">{s.sku}</span> needs {qty(s.shortBy)} more {materialLabel(s.materialCode)}
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
            notes: lot.notes,
          }}
          initialLines={initialLines}
          facilities={facilities}
          products={products.map((p) => ({ id: p.id, code: p.code, name: p.name, imageUrl: p.imageUrl }))}
          materialTypes={materialTypes}
          skuTxnCounts={skuTxnCounts}
        />
      </div>

      <div className="mt-8 max-w-2xl">
        <LotDocuments
          lotId={lot.id}
          documents={lot.documents.map((d) => ({ id: d.id, label: d.label, fileUrl: d.fileUrl, fileName: d.fileName }))}
        />
      </div>

      <div className="mt-10">
        <h2 className="mb-3 text-[15px] font-semibold text-ink-soft">Assigned transactions</h2>
        <TransactionInvoicesTable
          invoices={invoices}
          lots={lotOptions}
          suppliers={suppliers}
          skuImages={skuImages}
          showLotColumn={false}
          defaultLotId={lot.id}
        />
      </div>

      <DeleteLot lotId={lot.id} lotNr={lot.lotNr} />
    </>
  );
}

function materialLabel(code: string): string {
  const map: Record<string, string> = { POUCH: "pouches", TEABAG: "tea bags" };
  return map[code] ?? code.toLowerCase();
}

function Meta({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-[var(--radius-card)] border p-4 ${accent ? "border-accent-strong bg-accent-soft" : "border-border bg-surface"}`}>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 font-semibold text-ink tabular">{value}</div>
    </div>
  );
}
