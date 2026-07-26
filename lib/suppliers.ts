import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Shared supplier helpers.
 *
 * These live outside the `"use server"` action modules on purpose: every export of a
 * `"use server"` file is published as its own callable HTTP endpoint, whether or not the UI
 * ever calls it. An internal cleanup routine that hard-deletes rows has no business being
 * remotely invocable, so it belongs here.
 */

/** Find a supplier by name for the current org, creating it the first time it's used. */
export async function resolveSupplierId(name: string | null): Promise<string | null> {
  const trimmed = name?.trim().slice(0, 200);
  if (!trimmed) return null;
  const existing = await prisma.supplier.findFirst({ where: { name: trimmed } });
  return existing ? existing.id : (await prisma.supplier.create({ data: { name: trimmed } })).id;
}

/** Remove an auto-created supplier once nothing references it any more. */
export async function cleanupSupplierIfOrphan(supplierId: string | null): Promise<void> {
  if (!supplierId) return;
  const [purchases, transactions, purchaseInvoices, transactionInvoices] = await Promise.all([
    prisma.purchase.count({ where: { supplierId } }),
    prisma.transaction.count({ where: { supplierId } }),
    prisma.purchaseInvoice.count({ where: { supplierId } }),
    prisma.transactionInvoice.count({ where: { supplierId } }),
  ]);
  if (purchases + transactions + purchaseInvoices + transactionInvoices === 0) {
    await prisma.supplier.delete({ where: { id: supplierId } }).catch(() => {});
  }
}
