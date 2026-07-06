"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

/** Edit a supplier's contact details and optional facility link. */
export async function updateSupplier(input: {
  id: string;
  email: string;
  phone: string;
  address: string;
  facilityId: string | null; // this supplier IS one of our facilities
}) {
  // A facility can only be claimed by one supplier profile.
  if (input.facilityId) {
    const clash = await prisma.supplier.findFirst({
      where: { facilityId: input.facilityId, NOT: { id: input.id } },
      include: { facility: true },
    });
    if (clash) return { ok: false as const, error: `${clash.facility?.code} is already linked to ${clash.name}.` };
  }
  await prisma.supplier.update({
    where: { id: input.id },
    data: {
      email: input.email.trim() || null,
      phone: input.phone.trim() || null,
      address: input.address.trim() || null,
      facilityId: input.facilityId,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
