"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

/** Create a facility — a co-packer, warehouse, 3PL or anywhere else stock lives. */
export async function createFacility(input: { code: string; name: string; type: string }) {
  const code = input.code.trim().toUpperCase().replace(/\s+/g, "");
  const name = input.name.trim();
  if (!code) return { ok: false as const, error: "Short code required" };
  if (!name) return { ok: false as const, error: "Name required" };

  const clash = await prisma.facility.findFirst({ where: { code } });
  if (clash) return { ok: false as const, error: `Code ${code} already exists` };

  const f = await prisma.facility.create({ data: { code, name, type: input.type || "co-packer" } });
  revalidatePath("/", "layout");
  return { ok: true as const, id: f.id };
}

/** Edit a facility's details. `legalName`/`address` are what get printed on purchase orders. */
export async function updateFacility(input: {
  id: string;
  code: string;
  name: string;
  type: string;
  legalName: string;
  address: string;
  notes: string;
}) {
  const code = input.code.trim().toUpperCase().replace(/\s+/g, "");
  const name = input.name.trim();
  if (!code) return { ok: false as const, error: "Short code required" };
  if (!name) return { ok: false as const, error: "Name required" };

  const current = await prisma.facility.findFirst({ where: { id: input.id } });
  if (!current) return { ok: false as const, error: "Facility not found" };
  if (code !== current.code) {
    const clash = await prisma.facility.findFirst({ where: { code } });
    if (clash) return { ok: false as const, error: `Code ${code} already exists` };
  }

  await prisma.facility.update({
    where: { id: input.id },
    data: {
      code,
      name,
      type: input.type || "co-packer",
      legalName: input.legalName.trim() || null,
      address: input.address.trim() || null,
      notes: input.notes.trim() || null,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Delete a facility — refused while any lot, purchase or PO still points at it.
 *  A supplier profile linked to it is simply unlinked (the FK is set-null). */
export async function deleteFacility(id: string) {
  const facility = await prisma.facility.findFirst({ where: { id } });
  if (!facility) return { ok: false as const, error: "Facility not found" };

  const [lots, purchases, purchaseOrders] = await Promise.all([
    prisma.lot.count({ where: { facilityId: id } }),
    prisma.purchase.count({ where: { facilityId: id } }),
    prisma.purchaseOrder.count({ where: { facilityId: id } }),
  ]);
  if (lots + purchases + purchaseOrders > 0) {
    return { ok: false as const, error: "This facility is in use and can no longer be deleted." };
  }

  await prisma.facility.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
