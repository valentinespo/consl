"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/membership";

/** The pre-consl average cost per product — what a unit cost before consl kept the books. Prices
 *  sales that predate the product's first recorded FIFO layer. Blank clears it (the starting cost
 *  stands in again). */
export async function savePreConslCosts(entries: { productId: string; cost: number | null }[]) {
  const gate = await requirePermission("catalog", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  for (const e of entries) {
    if (e.cost != null && (!Number.isFinite(e.cost) || e.cost < 0)) return { ok: false as const, error: "Costs must be zero or more." };
  }
  const ids = entries.map((e) => e.productId);
  const owned = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } }); // org-scoped
  const ok = new Set(owned.map((p) => p.id));
  if (ids.some((id) => !ok.has(id))) return { ok: false as const, error: "Unknown product." };
  await prisma.$transaction(entries.map((e) => prisma.product.update({ where: { id: e.productId }, data: { preConslUnitCost: e.cost } })));
  revalidatePath("/pnl");
  return { ok: true as const };
}
