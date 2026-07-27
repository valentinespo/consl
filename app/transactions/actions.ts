"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { recomputeAll } from "@/lib/recompute";
import { isExcludedCategory } from "@/lib/categories";
import { resolveSupplierId, cleanupSupplierIfOrphan } from "@/lib/suppliers";
import { checkOwned, type OwnedModel } from "@/lib/ownership";
import { requirePermission } from "@/lib/membership";

export type InvoiceLineInput = {
  category: string; // TEA | OTHER | NOT_APPLICABLE
  amount: number;
  lotId: string | null;
  sku: string | null;
  concept: string | null;
};
export type InvoicePayload = {
  id?: string | null;
  supplierName: string | null;
  dateISO: string | null;
  invoiceTotal: number;
  lines: InvoiceLineInput[];
};

/** Create/update a transaction invoice + its allocation lines. Lines must sum to the total. */
export async function upsertTransactionInvoice(payload: InvoicePayload) {
  const gate = await requirePermission("transactions", payload.id ? "edit" : "create");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const lines = payload.lines.filter((l) => l.category || l.amount);
  if (lines.length === 0) return { ok: false as const, error: "Add at least one line." };

  // Reject non-finite money before the reconciliation check — any comparison with NaN is false,
  // so a NaN total would pass it and then break every aggregate that touches this invoice.
  if (!Number.isFinite(Number(payload.invoiceTotal))) {
    return { ok: false as const, error: "Enter a valid invoice total." };
  }
  if (!lines.every((l) => Number.isFinite(Number(l.amount)))) {
    return { ok: false as const, error: "Every line needs a valid amount." };
  }

  const owned = await checkOwned(lines.map((l) => ["lot", l.lotId] as [OwnedModel, string | null]));
  if (owned) return owned;

  const sum = lines.reduce((s, l) => s + Number(l.amount), 0);
  if (Math.abs(sum - payload.invoiceTotal) > 0.01) {
    return {
      ok: false as const,
      error: `Lines add up to ${sum.toFixed(2)} but the invoice total is ${payload.invoiceTotal.toFixed(2)}.`,
    };
  }

  const supplierId = await resolveSupplierId(payload.supplierName);
  const date = payload.dateISO ? new Date(payload.dateISO) : null;
  const toRow = (invoiceId: string) =>
    lines.map((l) => {
      const notApplicable = isExcludedCategory(l.category);
      return {
        invoiceId,
        lotId: l.lotId || null,
        supplierId,
        date,
        applicableAmount: Number(l.amount) || 0,
        category: l.category,
        appliesToCog: !notApplicable,
        skus: notApplicable ? null : l.sku && l.sku.toUpperCase() !== "ALL" ? l.sku.toUpperCase() : null,
        concept: l.concept?.trim() || null,
      };
    });

  let staleSuppliers: (string | null)[] = [];
  if (payload.id) {
    const old = await prisma.transaction.findMany({ where: { invoiceId: payload.id }, select: { supplierId: true } });
    staleSuppliers = old.map((o) => o.supplierId);
    await prisma.transaction.deleteMany({ where: { invoiceId: payload.id } });
    await prisma.transactionInvoice.update({ where: { id: payload.id }, data: { supplierId, date, invoiceTotal: payload.invoiceTotal } });
    await prisma.transaction.createMany({ data: toRow(payload.id) });
  } else {
    const inv = await prisma.transactionInvoice.create({ data: { supplierId, date, invoiceTotal: payload.invoiceTotal } });
    await prisma.transaction.createMany({ data: toRow(inv.id) });
  }

  for (const sid of new Set(staleSuppliers)) if (sid && sid !== supplierId) await cleanupSupplierIfOrphan(sid);
  await recomputeAll();
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function deleteTransactionInvoice(id: string) {
  const gate = await requirePermission("transactions", "delete");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const lines = await prisma.transaction.findMany({ where: { invoiceId: id }, select: { supplierId: true } });
  const inv = await prisma.transactionInvoice.findUnique({ where: { id }, select: { supplierId: true } });
  await prisma.transactionInvoice.delete({ where: { id } }); // cascades to lines
  for (const sid of new Set([inv?.supplierId ?? null, ...lines.map((l) => l.supplierId)])) await cleanupSupplierIfOrphan(sid);
  await recomputeAll();
  revalidatePath("/", "layout");
}
