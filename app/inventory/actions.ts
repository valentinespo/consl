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

/** Update the org-wide restock defaults. Shipping time is global only — it isn't per SKU. */
export async function updateGlobalDefaults(d: {
  minMonths: number;
  leadMonths: number;
  shipMonths: number;
  reorderTo: number;
}) {
  await saveOrgSettings({
    defaultMinMonths: clamp(d.minMonths, 0, 120),
    defaultLeadMonths: clamp(d.leadMonths, 0, 120),
    shipMonths: clamp(d.shipMonths, 0, 120),
    defaultReorderTo: clamp(d.reorderTo, 0.1, 120),
  });
  revalidatePath("/inventory");
  revalidatePath("/settings/sync");
  return { ok: true as const };
}

/** Set per-SKU policy overrides. Null on a field means "use the global default". */
export async function updateSkuPolicy(
  productId: string,
  p: {
    minMonths: number | null;
    leadMonths: number | null;
    reorderToMonths: number | null;
    batchSize: number | null;
  },
) {
  await prisma.product.update({
    where: { id: productId },
    data: {
      minMonths: p.minMonths == null ? null : clamp(p.minMonths, 0, 120),
      leadMonths: p.leadMonths == null ? null : clamp(p.leadMonths, 0, 120),
      reorderToMonths: p.reorderToMonths == null ? null : clamp(p.reorderToMonths, 0.1, 120),
      batchSize: p.batchSize == null ? null : Math.max(0, Math.floor(p.batchSize)) || null,
    },
  });
  revalidatePath("/inventory");
  return { ok: true as const };
}

/** Keep a typo in a settings box from producing a nonsense engine input. */
function clamp(v: number, lo: number, hi: number) {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
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
