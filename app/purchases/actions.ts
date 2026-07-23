"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { recomputeAll } from "@/lib/recompute";
import { cleanupSupplierIfOrphan } from "@/app/transactions/actions";

async function resolveSupplierId(name: string | null): Promise<string | null> {
  if (!name) return null;
  const existing = await prisma.supplier.findFirst({ where: { name } });
  return existing ? existing.id : (await prisma.supplier.create({ data: { name } })).id;
}

export type PurchaseLineInput = {
  facilityId: string;
  productId: string | null;
  quantity: number;
  total: number;
};
export type PurchaseInvoicePayload = {
  id?: string | null;
  materialTypeId: string;
  supplierName: string | null;
  dateISO: string | null;
  invoiceTotal: number;
  isAdjustment: boolean;
  lines: PurchaseLineInput[];
};

/** Create/update a purchase invoice (one material) + its lines. Lines must sum to the total. */
export async function upsertPurchaseInvoice(payload: PurchaseInvoicePayload) {
  const lines = payload.lines.filter((l) => l.facilityId);
  if (lines.length === 0) throw new Error("Add at least one line.");
  const sum = lines.reduce((s, l) => s + (Number(l.total) || 0), 0);
  if (Math.abs(sum - payload.invoiceTotal) > 0.01) {
    throw new Error(`Lines add up to $${sum.toFixed(2)} but the invoice total is $${payload.invoiceTotal.toFixed(2)}.`);
  }

  const material = await prisma.materialType.findUnique({ where: { id: payload.materialTypeId } });
  const supplierId = await resolveSupplierId(payload.supplierName);
  const date = payload.dateISO ? new Date(payload.dateISO) : new Date();
  const base = await prisma.purchase.count();
  const toRow = (invoiceId: string) =>
    lines.map((l, idx) => {
      const q = Number(l.quantity) || 0;
      const t = Number(l.total) || 0;
      return {
        invoiceId,
        materialTypeId: payload.materialTypeId,
        date,
        supplierId,
        facilityId: l.facilityId,
        productId: material?.skuSpecific ? l.productId || null : null,
        quantity: q,
        unitCost: q !== 0 ? t / q : 0,
        total: t,
        isAdjustment: payload.isAdjustment,
        seq: base + idx,
      };
    });

  let staleSuppliers: (string | null)[] = [];
  if (payload.id) {
    const old = await prisma.purchase.findMany({ where: { invoiceId: payload.id }, select: { supplierId: true } });
    staleSuppliers = old.map((o) => o.supplierId);
    await prisma.purchase.deleteMany({ where: { invoiceId: payload.id } });
    await prisma.purchaseInvoice.update({
      where: { id: payload.id },
      data: { supplierId, date, invoiceTotal: payload.invoiceTotal, isAdjustment: payload.isAdjustment, materialTypeId: payload.materialTypeId },
    });
    await prisma.purchase.createMany({ data: toRow(payload.id) });
  } else {
    const inv = await prisma.purchaseInvoice.create({
      data: { supplierId, materialTypeId: payload.materialTypeId, date, invoiceTotal: payload.invoiceTotal, isAdjustment: payload.isAdjustment },
    });
    await prisma.purchase.createMany({ data: toRow(inv.id) });
  }

  for (const sid of new Set(staleSuppliers)) if (sid && sid !== supplierId) await cleanupSupplierIfOrphan(sid);
  await recomputeAll();
  revalidatePath("/", "layout");
}

export async function deletePurchaseInvoice(id: string) {
  const lines = await prisma.purchase.findMany({ where: { invoiceId: id }, select: { supplierId: true } });
  const inv = await prisma.purchaseInvoice.findUnique({ where: { id }, select: { supplierId: true } });
  await prisma.purchaseInvoice.delete({ where: { id } }); // cascades to lines
  for (const sid of new Set([inv?.supplierId ?? null, ...lines.map((l) => l.supplierId)])) await cleanupSupplierIfOrphan(sid);
  await recomputeAll();
  revalidatePath("/", "layout");
}

