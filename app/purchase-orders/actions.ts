"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { generatePoPdf, poTotal, type PoPdfLine } from "@/lib/po-pdf";
import { getCurrentOrg, orgAddressLines, orgDocumentName } from "@/lib/org";
import { saveImage, readStored } from "@/lib/storage";
import { createLot } from "@/app/lots/actions";
import { recomputeAll } from "@/lib/recompute";

export type PoLineInput = {
  kind: "SKU" | "FEE";
  productId: string | null;
  description: string;
  unitCost: number | null; // null = TBD
  quantity: number;
  lotUnits: number | null; // SKU lines: units for the production lot
};

export type PoPayload = {
  id?: string | null;
  facilityId: string;
  dateISO: string;
  lines: PoLineInput[];
};

function validate(payload: PoPayload): string | null {
  const lines = payload.lines.filter((l) => l.description.trim() || l.quantity);
  if (!payload.facilityId) return "Pick a vendor.";
  if (!payload.dateISO) return "Pick a PO date.";
  if (lines.length === 0) return "Add at least one line.";
  for (const l of lines) {
    if (!l.description.trim()) return "Every line needs a description.";
    if (!(l.quantity > 0)) return "Every line needs a quantity.";
    if (l.kind === "SKU" && !l.productId) return "SKU lines must have a product selected.";
    if (l.kind === "SKU" && !(Number(l.lotUnits) > 0)) return "SKU lines need the lot units (finished units to produce).";
  }
  return null;
}

async function renderAndStorePdf(poId: string): Promise<string> {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: poId },
    include: {
      facility: { include: { supplierProfile: true } },
      lines: { include: { product: true }, orderBy: { seq: "asc" } },
    },
  });
  // The vendor block: when the facility is linked to a supplier, that supplier owns the address
  // (it's only entered in one place). Legal name still wins for the name when one was set.
  const supplier = po.facility.supplierProfile;
  const vendorName = po.facility.legalName ?? supplier?.name ?? po.facility.name;
  const vendorAddress = supplier?.address ?? po.facility.address ?? "";
  const pdfLines: PoPdfLine[] = po.lines.map((l) => ({
    sku: l.product?.code ?? null,
    description: l.description,
    unitCost: l.unitCost,
    quantity: l.quantity,
  }));
  const org = await getCurrentOrg();
  const buf = await generatePoPdf({
    company: {
      name: orgDocumentName(org) || "Your company",
      addressLines: orgAddressLines(org),
      email: org?.email ?? null,
      phone: org?.phone ?? null,
      currencySymbol: org?.currencySymbol ?? "$",
      currencyCode: org?.currencyCode ?? "USD",
      locale: org?.locale ?? "en-US",
      logo: await readStored(org?.logoUrl ?? null),
    },
    number: po.number,
    dateISO: po.date.toISOString().slice(0, 10),
    vendorName,
    vendorAddress,
    lines: pdfLines,
  });
  // Key includes updatedAt so /media's immutable caching never serves a stale version.
  const slug = po.number.replace(/[^A-Za-z0-9-]+/g, "").toUpperCase();
  const url = await saveImage(`po/PO-${slug}-${po.updatedAt.getTime()}.pdf`, buf, "application/pdf");
  await prisma.purchaseOrder.update({ where: { id: poId }, data: { pdfUrl: url } });
  return url;
}

/** Create a PO: creates the matching production lot, the PO record, and its PDF. */
export async function createPurchaseOrder(payload: PoPayload) {
  const err = validate(payload);
  if (err) return { ok: false as const, error: err };
  const lines = payload.lines.filter((l) => l.description.trim() || l.quantity);

  const facility = await prisma.facility.findUnique({ where: { id: payload.facilityId } });
  if (!facility) return { ok: false as const, error: "Vendor not found." };

  // 1. Create the production lot from the SKU lines.
  const skuLines = lines.filter((l) => l.kind === "SKU");
  const lotRes = await createLot({
    poNumber: null, // set below once the lot number is known
    poDateISO: payload.dateISO,
    facilityId: payload.facilityId,
    status: "IN_PRODUCTION",
    lines: skuLines.map((l) => ({ productId: l.productId!, units: l.lotUnits! })),
  });
  if (!lotRes.ok) return { ok: false as const, error: lotRes.error ?? "Could not create the lot." };

  const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotRes.lotId } });
  const number = `#${lot.lotNr}-${facility.code}`;
  await prisma.lot.update({ where: { id: lot.id }, data: { poNumber: number } });

  // 2. Create the PO + lines.
  const po = await prisma.purchaseOrder.create({
    data: {
      number,
      date: new Date(payload.dateISO),
      status: "DRAFT",
      facilityId: payload.facilityId,
      lotId: lot.id,
      total: poTotal(lines.map((l) => ({ description: l.description, unitCost: l.unitCost, quantity: l.quantity }))),
      lines: {
        create: lines.map((l, i) => ({
          seq: i,
          kind: l.kind,
          productId: l.kind === "SKU" ? l.productId : null,
          description: l.description.trim(),
          unitCost: l.unitCost,
          quantity: l.quantity,
          lotUnits: l.kind === "SKU" ? l.lotUnits! : null,
        })),
      },
    },
  });

  // 3. Render the PDF.
  await renderAndStorePdf(po.id);
  revalidatePath("/", "layout");
  return { ok: true as const, poId: po.id, number, lotId: lot.id };
}

/** Edit a PO's header/lines and regenerate its PDF. Does NOT modify the linked lot. */
export async function updatePurchaseOrder(payload: PoPayload) {
  if (!payload.id) return { ok: false as const, error: "Missing PO id." };
  const current = await prisma.purchaseOrder.findUnique({ where: { id: payload.id }, select: { status: true } });
  if (current?.status === "SENT") return { ok: false as const, error: "This PO is marked as Sent and locked. Switch it to Draft first." };
  const err = validate(payload);
  if (err) return { ok: false as const, error: err };
  const lines = payload.lines.filter((l) => l.description.trim() || l.quantity);

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrderLine.deleteMany({ where: { poId: payload.id! } });
    await tx.purchaseOrder.update({
      where: { id: payload.id! },
      data: {
        date: new Date(payload.dateISO),
        total: poTotal(lines.map((l) => ({ description: l.description, unitCost: l.unitCost, quantity: l.quantity }))),
        lines: {
          create: lines.map((l, i) => ({
            seq: i,
            kind: l.kind,
            productId: l.kind === "SKU" ? l.productId : null,
            description: l.description.trim(),
            unitCost: l.unitCost,
            quantity: l.quantity,
            lotUnits: l.kind === "SKU" && l.lotUnits ? l.lotUnits : null,
          })),
        },
      },
    });
  });

  await renderAndStorePdf(payload.id);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function setPoStatus(id: string, status: "DRAFT" | "SENT") {
  await prisma.purchaseOrder.update({ where: { id }, data: { status } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Delete a PO. Sent POs are locked (switch to Draft first). For app-created POs the
 * auto-created production lot is deleted along with it; imported historical POs only
 * remove the archive record — their lots predate the PO and are kept.
 */
export async function deletePurchaseOrder(id: string) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!po) return { ok: true as const };
  if (po.status === "SENT") {
    return { ok: false as const, error: "Sent POs can't be deleted — switch it to Draft first." };
  }
  await prisma.purchaseOrder.delete({ where: { id } });
  // Only app-created POs own their lot; imported archive POs never touch historical lots.
  if (!po.imported && po.lotId) {
    await prisma.lot.delete({ where: { id: po.lotId } }).catch(() => {});
    await recomputeAll();
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}
