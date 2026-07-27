"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { recomputeAll } from "@/lib/recompute";
import { checkOwned, type OwnedModel } from "@/lib/ownership";
import { requirePermission } from "@/lib/membership";
import { createLotCore, defaultMaterialsFor } from "@/lib/lot-core";

/** Permanently delete a lot (cascades its SKU lines, bill of materials and transactions). */
export async function deleteLot(formData: FormData) {
  const gate = await requirePermission("lots", "delete");
  if (!gate.ok) redirect("/lots"); // fail closed; the control is hidden from members who can't delete
  const lotId = String(formData.get("lotId"));
  const lot = await prisma.lot.findFirst({ where: { id: lotId }, select: { id: true } });
  if (!lot) redirect("/lots");

  // Note which suppliers this lot's own transactions referenced, BEFORE the cascade removes them.
  // Only those are candidates for cleanup — sweeping every supplier would delete the ones a user
  // set up in advance, which have no purchases or transactions by definition.
  const touched = await prisma.transaction.findMany({
    where: { lotId: lot.id, supplierId: { not: null } },
    select: { supplierId: true },
    distinct: ["supplierId"],
  });

  await prisma.lot.delete({ where: { id: lot.id } });
  await recomputeAll();

  for (const { supplierId } of touched) {
    if (!supplierId) continue;
    // All four reference tables — an invoice header alone still counts as in use.
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

  revalidatePath("/", "layout");
  redirect("/lots");
}

/** Create a new production lot with its SKU lines and default bill of materials. The heavy lifting
 *  lives in createLotCore so PO creation can reuse it; this entry point adds the permission gate. */
export async function createLot(input: {
  poNumber: string | null;
  poDateISO: string | null;
  facilityId: string;
  status: "IN_PRODUCTION" | "FINISHED";
  lines: { productId: string; units: number }[];
}) {
  const gate = await requirePermission("lots", "create");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  return createLotCore(input);
}

export type LotEditPayload = {
  lotId: string;
  poNumber: string | null;
  poDateISO: string | null;
  facilityId: string;
  status: "IN_PRODUCTION" | "FINISHED";
  finishedAtISO: string | null; // required when FINISHED (defaults to today); ignored otherwise
  notes: string | null;
  lines: {
    id: string | null; // null = newly added SKU
    productId: string;
    units: number;
    materials: { materialTypeId: string; perUnit: number }[];
  }[];
};

/** One batched save for the whole lot: details, status, notes, SKU lines (add/remove/units) + BOM. */
export async function updateLot(payload: LotEditPayload) {
  const gate = await requirePermission("lots", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const lines = payload.lines.filter((l) => l.productId);
  if (lines.length === 0) return { ok: false as const, error: "A lot needs at least one SKU." };

  const existing = await prisma.lotLine.findMany({ where: { lotId: payload.lotId }, select: { id: true } });
  const keptIds = new Set(lines.filter((l) => l.id).map((l) => l.id!));
  const toRemove = existing.filter((e) => !keptIds.has(e.id));

  // The finished date is exactly what the form shows: FINISHED carries the typed date, or none at
  // all if it was cleared — an empty field must stay empty, not spring back to today. Any other
  // status carries none; keeping a stale date after a lot was flipped back to production made
  // "finished" lots that weren't.
  const finishedAt =
    payload.status === "FINISHED" && payload.finishedAtISO && !isNaN(Date.parse(payload.finishedAtISO))
      ? new Date(payload.finishedAtISO)
      : null;

  const badRef = await checkOwned([
    ["facility", payload.facilityId],
    ...lines.map((l) => ["product", l.productId] as [OwnedModel, string]),
    ...lines.flatMap((l) => l.materials.map((m) => ["material", m.materialTypeId] as [OwnedModel, string])),
  ]);
  if (badRef) return badRef;

  const defaults = await defaultMaterialsFor(payload.facilityId);
  // Per-product materials carry the SKU so they draw the right per-SKU FIFO pool.
  const allMaterials = await prisma.materialType.findMany({ select: { id: true, skuSpecific: true } });
  const skuSpecificIds = new Set(allMaterials.filter((m) => m.skuSpecific).map((m) => m.id));

  await prisma.$transaction(async (tx) => {
    await tx.lot.update({
      where: { id: payload.lotId },
      data: {
        poNumber: payload.poNumber?.trim() || null,
        poDate: payload.poDateISO ? new Date(payload.poDateISO) : null,
        facilityId: payload.facilityId,
        status: payload.status,
        finishedAt,
        notes: payload.notes?.trim() || null,
      },
    });

    for (const r of toRemove) await tx.lotLine.delete({ where: { id: r.id } }); // cascades its BOM

    let seq = 0;
    for (const l of lines) {
      const units = Math.max(0, Number(l.units) || 0);
      const writeMaterials = async (lotLineId: string, mats: { materialTypeId: string; perUnit: number }[]) => {
        await tx.lotMaterial.deleteMany({ where: { lotLineId } });
        for (const m of mats) {
          if (!m.materialTypeId || !(m.perUnit > 0)) continue;
          await tx.lotMaterial.create({
            data: {
              lotLineId,
              materialTypeId: m.materialTypeId,
              perUnit: m.perUnit,
              productId: skuSpecificIds.has(m.materialTypeId) ? l.productId : null,
            },
          });
        }
      };
      if (l.id) {
        await tx.lotLine.update({ where: { id: l.id }, data: { units, seq } });
        await writeMaterials(l.id, l.materials);
      } else {
        const created = await tx.lotLine.create({ data: { lotId: payload.lotId, productId: l.productId, units, seq } });
        const mats = l.materials.length
          ? l.materials
          : defaults.map((m) => ({ materialTypeId: m.id, perUnit: m.defaultPerUnit || 1 }));
        await writeMaterials(created.id, mats);
      }
      seq++;
    }
  });

  await recomputeAll();
  revalidatePath("/", "layout");
  return { ok: true as const };
}

