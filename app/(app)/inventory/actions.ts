"use server";

import { prisma } from "@/lib/prisma";
import { saveOrgSettings } from "@/lib/settings";
import { syncAllChannelsCore } from "@/lib/sync";
import { getRestock } from "@/lib/restock";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/membership";

/**
 * Manual "Sync channels" button: pull fresh stock from every connected sales channel, record the
 * value snapshot, revalidate.
 *
 * Each channel is independent — one being disconnected or erroring must not stop the others, so
 * every leg is caught and reported separately. Amazon carries the sales history the reorder engine
 * needs, so its failure is the only one that counts as an overall failure.
 */
export async function syncChannels(): Promise<{
  ok: boolean;
  synced: string[];
  failed: string[];
  salesOk: boolean;
  error?: string;
}> {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false, synced: [], failed: [], salesOk: true, error: gate.error };

  const { synced: done, failed, salesOk } = await syncAllChannelsCore();

  // Snapshot after every channel has landed, so the day's value includes all of them.
  await getRestock();
  revalidatePath("/inventory");
  revalidatePath("/facilities");
  revalidatePath("/reorder");
  revalidatePath("/");

  if (done.length === 0 && failed.length === 0) {
    return { ok: false, synced: [], failed: [], salesOk: true, error: "No sales channel is connected yet." };
  }
  return {
    ok: failed.length === 0,
    synced: done,
    failed,
    salesOk,
    error: failed.length ? `Couldn't reach ${failed.join(" and ")}.` : undefined,
  };
}

/** Update the org-wide restock defaults (each is a per-SKU-overridable fallback). */
export async function updateGlobalDefaults(d: {
  minMonths: number;
  leadMonths: number;
  shipDays: number;
  shipBufferX: number;
  reorderTo: number;
  batchSize: number;
}) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  await saveOrgSettings({
    defaultMinMonths: clamp(d.minMonths, 0, 120),
    defaultLeadMonths: clamp(d.leadMonths, 0, 120),
    shipDays: Math.round(clamp(d.shipDays, 0, 3650)),
    shipBufferX: clamp(d.shipBufferX, 0, 100),
    defaultReorderTo: clamp(d.reorderTo, 0.1, 120), // months of sales per order
    defaultBatchSize: Math.round(clamp(d.batchSize, 0, 10_000_000)),
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
    shipDays: number | null;
    reorderToMonths: number | null;
    batchSize: number | null;
  },
) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  await prisma.product.update({
    where: { id: productId },
    data: {
      minMonths: p.minMonths == null ? null : clamp(p.minMonths, 0, 120),
      leadMonths: p.leadMonths == null ? null : clamp(p.leadMonths, 0, 120),
      shipDays: p.shipDays == null ? null : Math.round(clamp(p.shipDays, 0, 3650)),
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
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  await prisma.product.update({ where: { id: productId }, data: { windowDays, excludeDays } });
  revalidatePath("/inventory");
  return { ok: true as const };
}

/** Set the inventory dashboard sort mode: "sales" | "available" | "manual". */
export async function setSortMode(mode: string) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  await saveOrgSettings({ sortMode: mode });
  revalidatePath("/inventory");
  return { ok: true as const };
}

/** Save a manual SKU order (array of product ids, top to bottom) and switch to manual sort. */
export async function saveManualOrder(orderedIds: string[]) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  await prisma.$transaction(orderedIds.map((id, i) => prisma.product.update({ where: { id }, data: { sortIndex: i } })));
  await saveOrgSettings({ sortMode: "manual" });
  revalidatePath("/inventory");
  return { ok: true as const };
}
