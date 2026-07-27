"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkOwned } from "@/lib/ownership";

/** Edit a supplier's name, contact details and optional facility link. */
export async function updateSupplier(input: {
  id: string;
  name?: string;
  email: string;
  phone: string;
  address: string;
  notes?: string;
  facilityId: string | null; // this supplier IS one of our facilities
}) {
  // The facility must be one of ours — otherwise a supplier could link to another org's
  // unclaimed facility id and surface its address through the supplier detail page.
  const badRef = await checkOwned([["facility", input.facilityId]]);
  if (badRef) return badRef;

  // A facility can only be claimed by one supplier profile.
  if (input.facilityId) {
    const clash = await prisma.supplier.findFirst({
      where: { facilityId: input.facilityId, NOT: { id: input.id } },
      include: { facility: true },
    });
    if (clash) return { ok: false as const, error: `${clash.facility?.code} is already linked to ${clash.name}.` };
  }

  const current = await prisma.supplier.findFirst({ where: { id: input.id } });
  if (!current) return { ok: false as const, error: "Supplier not found" };

  const name = (input.name ?? current.name).trim();
  if (!name) return { ok: false as const, error: "Name required" };
  if (name !== current.name) {
    const nameClash = await prisma.supplier.findFirst({ where: { name, NOT: { id: input.id } } });
    if (nameClash) return { ok: false as const, error: `A supplier called ${name} already exists.` };
  }

  await prisma.supplier.update({
    where: { id: input.id },
    data: {
      name,
      email: input.email.trim() || null,
      phone: input.phone.trim() || null,
      address: input.address.trim() || null,
      ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
      facilityId: input.facilityId,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Add a supplier directly. Until now they only appeared as a side effect of logging an invoice,
 *  which left a new account with no way to set one up in advance. */
export async function createSupplier(input: { name: string }) {
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Name required" };

  const existing = await prisma.supplier.findFirst({ where: { name } });
  if (existing) return { ok: false as const, error: `A supplier called ${name} already exists.` };

  const s = await prisma.supplier.create({ data: { name } });
  revalidatePath("/", "layout");
  return { ok: true as const, id: s.id };
}

/** Delete a supplier — refused while any purchase, transaction or invoice still references it. */
export async function deleteSupplier(id: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id } });
  if (!supplier) return { ok: false as const, error: "Supplier not found" };

  const [purchases, transactions, purchaseInvoices, transactionInvoices] = await Promise.all([
    prisma.purchase.count({ where: { supplierId: id } }),
    prisma.transaction.count({ where: { supplierId: id } }),
    prisma.purchaseInvoice.count({ where: { supplierId: id } }),
    prisma.transactionInvoice.count({ where: { supplierId: id } }),
  ]);
  if (purchases + transactions + purchaseInvoices + transactionInvoices > 0) {
    return { ok: false as const, error: "This supplier is in use and can no longer be deleted." };
  }

  await prisma.supplier.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
