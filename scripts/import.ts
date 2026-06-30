/**
 * Imports the spreadsheet into the database as INVOICES (each fanning out into lines),
 * preserving any uploaded images. Idempotent: wipes + reloads. Then runs the FIFO engine.
 *
 * Usage: npx tsx scripts/import.ts
 */
import path from "node:path";
import { prisma } from "../lib/prisma";
import { parseWorkbook } from "../lib/xlsx-source";
import { recomputeAll } from "../lib/recompute";

const XLSX = path.resolve(process.cwd(), "../Lots, Inventory & Purchases (App).xlsx");

const round2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Lot notes = the sheet's note + a summary of INBOUND (Amazon) fees, which are excluded from COG. */
function buildNotes(lot: { notes: string | null; inboundTxns: { amount: number; concept: string | null; supplier: string | null }[] }): string | null {
  const parts: string[] = [];
  if (lot.notes) parts.push(lot.notes);
  if (lot.inboundTxns.length) {
    const total = lot.inboundTxns.reduce((s, t) => s + t.amount, 0);
    const lines = lot.inboundTxns.map(
      (t) => `  • ${usd(t.amount)}${t.concept ? ` — ${t.concept}` : ""}${t.supplier ? ` (${t.supplier})` : ""}`,
    );
    parts.push(`Inbound fees (excluded from COG): ${usd(total)} total\n${lines.join("\n")}`);
  }
  return parts.join("\n\n") || null;
}

const MATERIALS = [
  { code: "TEABAG", name: "Tea Bag", unitLabel: "bag", defaultPerUnit: 15, poolKey: "FACILITY", skuSpecific: false },
  { code: "POUCH", name: "Pouch", unitLabel: "pouch", defaultPerUnit: 1, poolKey: "FACILITY_SKU", skuSpecific: true },
];

async function wipe() {
  await prisma.transaction.deleteMany();
  await prisma.transactionInvoice.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.purchaseInvoice.deleteMany();
  await prisma.lotMaterial.deleteMany();
  await prisma.lotLine.deleteMany();
  await prisma.lot.deleteMany();
  await prisma.materialType.deleteMany();
  await prisma.product.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.facility.deleteMany();
}

async function main() {
  console.log("Parsing workbook…");
  const src = await parseWorkbook(XLSX);
  console.log(
    `  ${src.lots.length} lots, ${src.transactionInvoices.length} transaction invoices ` +
      `(${src.transactionInvoices.reduce((s, i) => s + i.lines.length, 0)} lines), ` +
      `${src.purchaseInvoices.length} purchase invoices ` +
      `(${src.purchaseInvoices.reduce((s, i) => s + i.lines.length, 0)} lines), ${src.suppliers.length} suppliers.`,
  );

  // Snapshot uploaded images (by stable code/name) so a re-import doesn't lose them.
  const prodImg = new Map((await prisma.product.findMany()).filter((p) => p.imageUrl).map((p) => [p.code, p.imageUrl!]));
  const supImg = new Map((await prisma.supplier.findMany()).filter((s) => s.photoUrl).map((s) => [s.name, s.photoUrl!]));
  const matImg = new Map((await prisma.materialType.findMany()).filter((m) => m.imageUrl).map((m) => [m.code, m.imageUrl!]));
  console.log(`Preserving images: ${prodImg.size} products, ${supImg.size} suppliers, ${matImg.size} materials.`);

  console.log("Wiping…");
  await wipe();

  // ---- Reference data (re-applying images) ----
  const facilityId = new Map<string, string>();
  for (const f of src.facilities) facilityId.set(f.code, (await prisma.facility.create({ data: f })).id);

  const productId = new Map<string, string>();
  for (const p of src.products) {
    const rec = await prisma.product.create({ data: { ...p, imageUrl: prodImg.get(p.code) ?? null } });
    productId.set(p.code, rec.id);
  }

  const supplierId = new Map<string, string>();
  for (const name of src.suppliers) {
    const rec = await prisma.supplier.create({ data: { name, photoUrl: supImg.get(name) ?? null } });
    supplierId.set(name, rec.id);
  }

  const materialId = new Map<string, string>();
  for (const m of MATERIALS) {
    const rec = await prisma.materialType.create({ data: { ...m, imageUrl: matImg.get(m.code) ?? null } });
    materialId.set(m.code, rec.id);
  }

  // ---- Lots + lines + bill of materials ----
  const teabagFacilities = new Set(
    src.purchaseInvoices.filter((i) => i.materialCode === "TEABAG").map((i) => i.lines[0]?.facility).filter(Boolean),
  );
  const lotIdByNr = new Map<number, string>();
  for (const lot of src.lots) {
    const created = await prisma.lot.create({
      data: {
        poNumber: lot.poNumber,
        lotNr: lot.lotNr,
        poDate: lot.poDate ? new Date(lot.poDate) : null,
        facilityId: facilityId.get(lot.facility)!,
        status: lot.lines.some((l) => l.status === "IN_PRODUCTION") ? "IN_PRODUCTION" : "FINISHED",
        notes: buildNotes(lot),
      },
    });
    lotIdByNr.set(lot.lotNr, created.id);
    for (const ln of lot.lines) {
      const line = await prisma.lotLine.create({
        data: { lotId: created.id, productId: productId.get(ln.sku)!, units: ln.units, seq: ln.seq },
      });
      await prisma.lotMaterial.create({
        data: { lotLineId: line.id, materialTypeId: materialId.get("POUCH")!, perUnit: 1, productId: productId.get(ln.sku)! },
      });
      if (teabagFacilities.has(lot.facility)) {
        await prisma.lotMaterial.create({ data: { lotLineId: line.id, materialTypeId: materialId.get("TEABAG")!, perUnit: 15 } });
      }
    }
  }

  // ---- Transaction invoices + lines ----
  for (const inv of src.transactionInvoices) {
    const sid = inv.supplier ? supplierId.get(inv.supplier) ?? null : null;
    const created = await prisma.transactionInvoice.create({
      data: {
        supplierId: sid,
        date: inv.date ? new Date(inv.date) : null,
        // Trust the detailed lines (they reconcile to the sheet's COG totals) over the
        // hand-entered invoice cell, so every invoice loads internally consistent.
        invoiceTotal: round2(inv.lines.reduce((s, l) => s + l.amount, 0)),
      },
    });
    for (const ln of inv.lines) {
      await prisma.transaction.create({
        data: {
          invoiceId: created.id,
          lotId: ln.lotNr != null ? lotIdByNr.get(ln.lotNr) ?? null : null,
          supplierId: sid,
          date: inv.date ? new Date(inv.date) : null,
          applicableAmount: ln.amount,
          category: ln.category,
          appliesToCog: ln.appliesToCog,
          skus: ln.sku && ln.sku.toUpperCase() !== "ALL" ? ln.sku.toUpperCase() : null,
          concept: ln.concept,
        },
      });
    }
  }

  // ---- Purchase invoices + lines ----
  for (const inv of src.purchaseInvoices) {
    const sid = inv.supplier ? supplierId.get(inv.supplier) ?? null : null;
    const created = await prisma.purchaseInvoice.create({
      data: {
        supplierId: sid,
        materialTypeId: materialId.get(inv.materialCode)!,
        date: new Date(inv.date),
        invoiceTotal: round2(inv.lines.reduce((s, l) => s + l.total, 0)),
        isAdjustment: inv.isAdjustment,
        notes: inv.notes,
      },
    });
    for (const ln of inv.lines) {
      await prisma.purchase.create({
        data: {
          invoiceId: created.id,
          materialTypeId: materialId.get(inv.materialCode)!,
          date: new Date(inv.date),
          supplierId: sid,
          facilityId: facilityId.get(ln.facility)!,
          productId: ln.sku ? productId.get(ln.sku) ?? null : null,
          quantity: ln.quantity,
          unitCost: ln.unitCost,
          total: ln.total,
          seq: ln.seq,
          isAdjustment: ln.isAdjustment,
        },
      });
    }
  }

  console.log("Running FIFO engine…");
  await recomputeAll();
  console.log(
    `✅ Import complete. ${await prisma.transaction.count()} transaction lines, ${await prisma.purchase.count()} purchase lines, ${await prisma.lotLine.count()} lot lines costed.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
