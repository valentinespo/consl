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
  // COST axis: estimates carry expected costs into COG immediately, then get replaced/accepted.
  isEstimate?: boolean;
  // PAYMENT axis (payables only — never read by the cost engine). dueDate = balance due date;
  // amountPaid = running total; paidAt is DERIVED (set once fully paid), never sent by the client.
  dueDateISO?: string | null;
  amountPaid?: number | null;
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

  const isEstimate = !!payload.isEstimate;
  const dueDate = payload.dueDateISO ? new Date(payload.dueDateISO) : null;
  const amountPaid = payload.amountPaid != null && Number.isFinite(Number(payload.amountPaid)) ? Number(payload.amountPaid) : null;
  // paidAt is derived, not entered: fully covered → stamped now (kept if already set); else null.
  const fullyPaid = amountPaid != null && amountPaid >= payload.invoiceTotal - 0.01;

  let staleSuppliers: (string | null)[] = [];
  let invoiceId = payload.id;
  if (payload.id) {
    const prev = await prisma.transactionInvoice.findFirst({ where: { id: payload.id } });
    if (!prev) return { ok: false as const, error: "Invoice not found." };
    const old = await prisma.transaction.findMany({ where: { invoiceId: payload.id }, select: { supplierId: true } });
    staleSuppliers = old.map((o) => o.supplierId);
    await prisma.transaction.deleteMany({ where: { invoiceId: payload.id } });
    await prisma.transactionInvoice.update({
      where: { id: payload.id },
      data: {
        supplierId,
        date,
        invoiceTotal: payload.invoiceTotal,
        isEstimate,
        dueDate,
        amountPaid,
        paidAt: fullyPaid ? (prev.paidAt ?? new Date()) : null,
      },
    });
    await prisma.transaction.createMany({ data: toRow(payload.id) });
    // True-up audit: an estimate whose numbers changed, or that just became final, is a cost
    // revision worth remembering — the engine reprices silently, this row explains the step.
    const amountChanged = Math.abs(prev.invoiceTotal - payload.invoiceTotal) > 0.005;
    if (prev.isEstimate && (amountChanged || !isEstimate)) {
      await prisma.costRevision.create({
        data: {
          invoiceId: payload.id,
          oldTotal: prev.invoiceTotal,
          newTotal: payload.invoiceTotal,
          note: !isEstimate ? "estimate replaced with final" : "estimate revised",
        },
      });
    }
  } else {
    const inv = await prisma.transactionInvoice.create({
      data: {
        supplierId,
        date,
        invoiceTotal: payload.invoiceTotal,
        isEstimate,
        dueDate,
        amountPaid,
        paidAt: fullyPaid ? new Date() : null,
      },
    });
    invoiceId = inv.id;
    await prisma.transaction.createMany({ data: toRow(inv.id) });
  }

  for (const sid of new Set(staleSuppliers)) if (sid && sid !== supplierId) await cleanupSupplierIfOrphan(sid);
  await recomputeAll();
  revalidatePath("/", "layout");
  // The id lets the form attach staged documents right after a create.
  return { ok: true as const, id: invoiceId! };
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

/** Accept an estimate's numbers as final (no edits): clears the flag; cost output is unchanged,
 *  so no recompute is needed — this is bookkeeping, not a reprice. */
export async function markEstimateFinal(id: string) {
  const gate = await requirePermission("transactions", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const inv = await prisma.transactionInvoice.findFirst({ where: { id } });
  if (!inv) return { ok: false as const, error: "Invoice not found." };
  if (!inv.isEstimate) return { ok: false as const, error: "This invoice isn't an estimate." };
  await prisma.transactionInvoice.update({ where: { id }, data: { isEstimate: false } });
  await prisma.costRevision.create({
    data: { invoiceId: id, oldTotal: inv.invoiceTotal, newTotal: inv.invoiceTotal, note: "estimate accepted as final" },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
