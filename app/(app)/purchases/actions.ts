"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { recomputeAll } from "@/lib/recompute";
import { cleanupSupplierIfOrphan } from "@/lib/suppliers";
import { checkOwned, type OwnedModel } from "@/lib/ownership";
import { requirePermission } from "@/lib/membership";

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
  lines: PurchaseLineInput[];
};

/** Create/update a purchase invoice (one material) + its lines. Lines must sum to the total. */
export async function upsertPurchaseInvoice(payload: PurchaseInvoicePayload) {
  const gate = await requirePermission("purchases", payload.id ? "edit" : "create");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const lines = payload.lines.filter((l) => l.facilityId);
  if (lines.length === 0) return { ok: false as const, error: "Add at least one line." };

  // Finite checks first. `Math.abs(sum - NaN) > 0.01` is false, so a NaN total would sail through
  // the reconciliation below and land in a float column — poisoning every SUM over it forever.
  if (!Number.isFinite(Number(payload.invoiceTotal))) {
    return { ok: false as const, error: "Enter a valid invoice total." };
  }
  if (!lines.every((l) => Number.isFinite(Number(l.total)) && Number.isFinite(Number(l.quantity)))) {
    return { ok: false as const, error: "Every line needs a valid quantity and amount." };
  }

  const material = await prisma.materialType.findFirst({ where: { id: payload.materialTypeId } });
  if (!material) return { ok: false as const, error: "That raw material no longer exists." };

  // Ids come from the browser — confirm each belongs to this organization before it is stored.
  const owned = await checkOwned([
    ...lines.map((l) => ["facility", l.facilityId] as [OwnedModel, string]),
    ...(material.skuSpecific ? lines.map((l) => ["product", l.productId] as [OwnedModel, string | null]) : []),
  ]);
  if (owned) return owned;

  // A per-SKU material stocked without a product lands in a pool no lot can ever look up:
  // 100% shortfall on every lot that needs it, and its value stranded in raw inventory forever.
  if (material.skuSpecific && lines.some((l) => !l.productId)) {
    return { ok: false as const, error: `${material.name} is stocked per product — pick one on every line.` };
  }

  const sum = lines.reduce((s, l) => s + Number(l.total), 0);
  if (Math.abs(sum - payload.invoiceTotal) > 0.01) {
    return {
      ok: false as const,
      error: `Lines add up to ${sum.toFixed(2)} but the invoice total is ${payload.invoiceTotal.toFixed(2)}.`,
    };
  }

  const supplierId = await resolveSupplierId(payload.supplierName);
  const date = payload.dateISO ? new Date(payload.dateISO) : new Date();
  // `seq` breaks FIFO ties within a date, so it must be stable across edits and deletes. A global
  // row count is neither: it shrinks when rows are removed, so re-saving an invoice hands out
  // values that collide with existing ones and silently reorders same-day layers. Index within
  // the invoice instead, and let the engine tie-break on the invoice's own creation time.
  const toRow = (invoiceId: string) =>
    lines.map((l, idx) => {
      const q = Number(l.quantity);
      const t = Number(l.total);
      return {
        invoiceId,
        materialTypeId: payload.materialTypeId,
        date,
        supplierId,
        facilityId: l.facilityId,
        productId: material.skuSpecific ? l.productId || null : null,
        quantity: q,
        unitCost: q !== 0 ? t / q : 0,
        total: t,
        seq: idx,
      };
    });

  let staleSuppliers: (string | null)[] = [];
  if (payload.id) {
    const old = await prisma.purchase.findMany({ where: { invoiceId: payload.id }, select: { supplierId: true } });
    staleSuppliers = old.map((o) => o.supplierId);
    await prisma.purchase.deleteMany({ where: { invoiceId: payload.id } });
    await prisma.purchaseInvoice.update({
      where: { id: payload.id },
      data: { supplierId, date, invoiceTotal: payload.invoiceTotal, materialTypeId: payload.materialTypeId },
    });
    await prisma.purchase.createMany({ data: toRow(payload.id) });
  } else {
    const inv = await prisma.purchaseInvoice.create({
      data: { supplierId, materialTypeId: payload.materialTypeId, date, invoiceTotal: payload.invoiceTotal },
    });
    await prisma.purchase.createMany({ data: toRow(inv.id) });
  }

  for (const sid of new Set(staleSuppliers)) if (sid && sid !== supplierId) await cleanupSupplierIfOrphan(sid);
  await recomputeAll();
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function deletePurchaseInvoice(id: string) {
  const gate = await requirePermission("purchases", "delete");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const lines = await prisma.purchase.findMany({ where: { invoiceId: id }, select: { supplierId: true } });
  const inv = await prisma.purchaseInvoice.findUnique({ where: { id }, select: { supplierId: true } });
  await prisma.purchaseInvoice.delete({ where: { id } }); // cascades to lines
  for (const sid of new Set([inv?.supplierId ?? null, ...lines.map((l) => l.supplierId)])) await cleanupSupplierIfOrphan(sid);
  await recomputeAll();
  revalidatePath("/", "layout");
}

