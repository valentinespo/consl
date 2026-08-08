"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { recomputeAll } from "@/lib/recompute";
import { checkOwned, type OwnedModel } from "@/lib/ownership";
import { requirePermission } from "@/lib/membership";
import { createLotCore, bomFromLatestLine } from "@/lib/lot-core";

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
  notes: string | null;
  // Status, payment and the finished metadata live per SKU line — the lot only derives.
  lines: {
    id: string | null; // null = newly added SKU
    productId: string;
    units: number;
    status: "IN_PRODUCTION" | "FINISHED";
    paymentStatus: "PAID" | "DUE";
    finishedAtISO: string | null; // FINISHED carries the typed date (or none if cleared); else null
    expiryISO: string | null; // only meaningful when FINISHED
    batchNr: string | null; // only meaningful when FINISHED
    materials: { materialTypeId: string; perUnit: number }[];
  }[];
};

/** One batched save for the whole lot: details, notes, SKU lines (add/remove/units/status) + BOM. */
export async function updateLot(payload: LotEditPayload) {
  const gate = await requirePermission("lots", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const lines = payload.lines.filter((l) => l.productId);
  if (lines.length === 0) return { ok: false as const, error: "A lot needs at least one SKU." };

  const existing = await prisma.lotLine.findMany({ where: { lotId: payload.lotId }, select: { id: true } });
  const keptIds = new Set(lines.filter((l) => l.id).map((l) => l.id!));
  const toRemove = existing.filter((e) => !keptIds.has(e.id));

  const badRef = await checkOwned([
    ["facility", payload.facilityId],
    ...lines.map((l) => ["product", l.productId] as [OwnedModel, string]),
    ...lines.flatMap((l) => l.materials.map((m) => ["material", m.materialTypeId] as [OwnedModel, string])),
  ]);
  if (badRef) return badRef;

  // Only NEW lines inherit a recipe, and the lookup runs before any row is written so a line
  // added in this very save can't be its own "latest lot" source.
  const inherited = await bomFromLatestLine(payload.lines.filter((l) => !l.id).map((l) => l.productId));
  // Per-product materials carry the SKU so they draw the right per-SKU FIFO pool.
  const allMaterials = await prisma.materialType.findMany({ select: { id: true, skuSpecific: true } });
  const skuSpecificIds = new Set(allMaterials.filter((m) => m.skuSpecific).map((m) => m.id));

  // Per-line lifecycle fields, with the long-standing rule intact: FINISHED carries exactly what
  // the form shows (an empty date stays empty, never springs back to today); flipping back to
  // production clears date/expiry/batch rather than leaving stale metadata behind.
  const lineStatus = (l: LotEditPayload["lines"][number]) => {
    const finished = l.status === "FINISHED";
    return {
      status: finished ? ("FINISHED" as const) : ("IN_PRODUCTION" as const),
      paymentStatus: l.paymentStatus === "PAID" ? "PAID" : "DUE",
      finishedAt: finished && l.finishedAtISO && !isNaN(Date.parse(l.finishedAtISO)) ? new Date(l.finishedAtISO) : null,
      expiryAt: finished && l.expiryISO && !isNaN(Date.parse(l.expiryISO)) ? new Date(l.expiryISO) : null,
      batchNr: finished ? l.batchNr?.trim() || null : null,
    };
  };

  // The lot's own columns stay a derived cache (FINISHED/PAID only when EVERY line is) so any
  // straggler reader stays roughly right; the app itself derives from the lines.
  const allFinished = lines.every((l) => l.status === "FINISHED");
  const statuses = lines.map((l) => lineStatus(l));
  const lotCache = {
    status: allFinished ? ("FINISHED" as const) : ("IN_PRODUCTION" as const),
    paymentStatus: lines.every((l) => l.paymentStatus === "PAID") ? "PAID" : "DUE",
    finishedAt: allFinished
      ? statuses.reduce<Date | null>((m, c) => (c.finishedAt && (!m || c.finishedAt > m) ? c.finishedAt : m), null)
      : null,
  };

  // Batched writes (one deleteMany + one createMany for the BOM instead of per-row round trips) —
  // a six-SKU lot saved over a remote DB link blew Prisma's 5s interactive-transaction limit.
  await prisma.$transaction(
    async (tx) => {
      await tx.lot.update({
        where: { id: payload.lotId },
        data: {
          poNumber: payload.poNumber?.trim() || null,
          poDate: payload.poDateISO ? new Date(payload.poDateISO) : null,
          facilityId: payload.facilityId,
          notes: payload.notes?.trim() || null,
          ...lotCache,
        },
      });

      if (toRemove.length) await tx.lotLine.deleteMany({ where: { id: { in: toRemove.map((r) => r.id) } } }); // cascades BOM

      const matRows: { lotLineId: string; materialTypeId: string; perUnit: number; productId: string | null }[] = [];
      const lineIds: string[] = [];
      let seq = 0;
      for (const [i, l] of lines.entries()) {
        const units = Math.max(0, Number(l.units) || 0);
        let lineId: string;
        if (l.id) {
          await tx.lotLine.update({ where: { id: l.id }, data: { units, seq, ...statuses[i] } });
          lineId = l.id;
        } else {
          const created = await tx.lotLine.create({
            data: { lotId: payload.lotId, productId: l.productId, units, seq, ...statuses[i] },
          });
          lineId = created.id;
        }
        lineIds.push(lineId);
        // A NEW line with no explicit BOM starts from its SKU's latest-lot recipe — empty when the
        // SKU has never been in a lot. An existing line with an emptied BOM stays empty (the
        // operator deleted its rows on purpose).
        const mats = l.materials.length
          ? l.materials
          : l.id
            ? []
            : (inherited.get(l.productId) ?? []).map((m) => ({ materialTypeId: m.materialTypeId, perUnit: m.perUnit }));
        for (const m of mats) {
          if (!m.materialTypeId || !(m.perUnit > 0)) continue;
          matRows.push({
            lotLineId: lineId,
            materialTypeId: m.materialTypeId,
            perUnit: m.perUnit,
            productId: skuSpecificIds.has(m.materialTypeId) ? l.productId : null,
          });
        }
        seq++;
      }

      await tx.lotMaterial.deleteMany({ where: { lotLineId: { in: lineIds } } });
      if (matRows.length) await tx.lotMaterial.createMany({ data: matRows });
    },
    { timeout: 15000 },
  );

  await recomputeAll();
  revalidatePath("/", "layout");
  return { ok: true as const };
}

