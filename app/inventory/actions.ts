"use server";

import { prisma } from "@/lib/prisma";
import { saveOrgSettings } from "@/lib/settings";
import { syncAmazonCore } from "@/lib/sync";
import { getRestock } from "@/lib/restock";
import { revalidatePath } from "next/cache";

/** Manual "Sync Amazon" button: pull fresh Amazon data, record the value snapshot, revalidate. */
export async function syncAmazon() {
  const r = await syncAmazonCore();
  if (r.ok) await getRestock(); // records today's inventory-value snapshot with fresh numbers
  revalidatePath("/inventory");
  revalidatePath("/");
  return r;
}

/** Update the global default floor + lead time. */
export async function updateGlobalDefaults(minMonths: number, leadMonths: number) {
  await saveOrgSettings({ defaultMinMonths: minMonths, defaultLeadMonths: leadMonths });
  revalidatePath("/inventory");
  return { ok: true as const };
}

/** Set a per-SKU floor + lead override. Pass null to fall back to the global default. */
export async function updateSkuPolicy(productId: string, minMonths: number | null, leadMonths: number | null) {
  await prisma.product.update({ where: { id: productId }, data: { minMonths, leadMonths } });
  revalidatePath("/inventory");
  return { ok: true as const };
}

/** Set (or clear) a per-SKU velocity window override + OOS-day exclusion. Pass nulls to clear. */
export async function setSkuWindow(productId: string, windowDays: number | null, excludeDays: number | null) {
  await prisma.product.update({ where: { id: productId }, data: { windowDays, excludeDays } });
  revalidatePath("/inventory");
  return { ok: true as const };
}

/** Set the inventory dashboard sort mode: "sales" | "available" | "manual". */
export async function setSortMode(mode: string) {
  await saveOrgSettings({ sortMode: mode });
  revalidatePath("/inventory");
  return { ok: true as const };
}

/** Save a manual SKU order (array of product ids, top to bottom) and switch to manual sort. */
export async function saveManualOrder(orderedIds: string[]) {
  await prisma.$transaction(orderedIds.map((id, i) => prisma.product.update({ where: { id }, data: { sortIndex: i } })));
  await saveOrgSettings({ sortMode: "manual" });
  revalidatePath("/inventory");
  return { ok: true as const };
}
