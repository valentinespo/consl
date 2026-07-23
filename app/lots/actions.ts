"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { recomputeAll } from "@/lib/recompute";

/** Permanently delete a lot (cascades its SKU lines, bill of materials and transactions). */
export async function deleteLot(formData: FormData) {
  const lotId = String(formData.get("lotId"));
  await prisma.lot.delete({ where: { id: lotId } });
  await recomputeAll();
  // Remove suppliers left with no purchases or transactions after the cascade.
  const suppliers = await prisma.supplier.findMany({ include: { _count: { select: { purchases: true, transactions: true } } } });
  for (const s of suppliers) {
    if (s._count.purchases === 0 && s._count.transactions === 0) await prisma.supplier.delete({ where: { id: s.id } }).catch(() => {});
  }
  revalidatePath("/", "layout");
  redirect("/lots");
}

/** Smallest positive lot number not in use — deleted numbers get reused (e.g. a scrapped PO #21). */
async function nextFreeLotNr(): Promise<number> {
  const used = new Set((await prisma.lot.findMany({ select: { lotNr: true } })).map((l) => l.lotNr));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** Create a new production lot with its SKU lines and default bill of materials. */
export async function createLot(input: {
  poNumber: string | null;
  poDateISO: string | null;
  facilityId: string;
  status: "IN_PRODUCTION" | "FINISHED";
  lines: { productId: string; units: number }[];
}) {
  const lines = input.lines.filter((l) => l.productId && l.units > 0);
  if (!input.facilityId || lines.length === 0) return { ok: false as const, error: "Pick a facility and at least one SKU with units" };

  const lotNr = await nextFreeLotNr();

  const [teabag, pouch] = await Promise.all([
    prisma.materialType.findFirst({ where: { code: "TEABAG" } }),
    prisma.materialType.findFirst({ where: { code: "POUCH" } }),
  ]);
  const facilityUsesTeabag =
    teabag != null && (await prisma.purchase.count({ where: { materialTypeId: teabag.id, facilityId: input.facilityId } })) > 0;

  const lot = await prisma.lot.create({
    data: {
      lotNr,
      poNumber: input.poNumber?.trim() || `#${lotNr}`,
      poDate: input.poDateISO ? new Date(input.poDateISO) : new Date(),
      facilityId: input.facilityId,
      status: input.status,
      finishedAt: input.status === "FINISHED" ? new Date() : null,
      lines: { create: lines.map((l, i) => ({ productId: l.productId, units: Math.round(l.units), seq: i })) },
    },
    include: { lines: true },
  });

  for (const line of lot.lines) {
    if (pouch) {
      await prisma.lotMaterial.create({
        data: { lotLineId: line.id, materialTypeId: pouch.id, perUnit: pouch.defaultPerUnit || 1, productId: line.productId },
      });
    }
    if (facilityUsesTeabag && teabag) {
      await prisma.lotMaterial.create({
        data: { lotLineId: line.id, materialTypeId: teabag.id, perUnit: teabag.defaultPerUnit || 15 },
      });
    }
  }

  await recomputeAll();
  revalidatePath("/", "layout");
  return { ok: true as const, lotId: lot.id };
}

export type LotEditPayload = {
  lotId: string;
  poNumber: string | null;
  poDateISO: string | null;
  facilityId: string;
  status: "IN_PRODUCTION" | "FINISHED";
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
  const lines = payload.lines.filter((l) => l.productId);
  if (lines.length === 0) return { ok: false as const, error: "A lot needs at least one SKU." };

  const existing = await prisma.lotLine.findMany({ where: { lotId: payload.lotId }, select: { id: true } });
  const keptIds = new Set(lines.filter((l) => l.id).map((l) => l.id!));
  const toRemove = existing.filter((e) => !keptIds.has(e.id));

  // Stamp finishedAt only on the transition into FINISHED (latest wins; left intact if unmarked later).
  const currentLot = await prisma.lot.findUnique({ where: { id: payload.lotId }, select: { status: true } });
  const justFinished = payload.status === "FINISHED" && currentLot?.status !== "FINISHED";

  const [teabag, pouch] = await Promise.all([
    prisma.materialType.findFirst({ where: { code: "TEABAG" } }),
    prisma.materialType.findFirst({ where: { code: "POUCH" } }),
  ]);
  const facilityUsesTeabag =
    teabag != null && (await prisma.purchase.count({ where: { materialTypeId: teabag.id, facilityId: payload.facilityId } })) > 0;
  // Pouch lines carry the SKU so they draw the right per-SKU FIFO pool.
  const pouchId = pouch?.id;

  await prisma.$transaction(async (tx) => {
    await tx.lot.update({
      where: { id: payload.lotId },
      data: {
        poNumber: payload.poNumber?.trim() || null,
        poDate: payload.poDateISO ? new Date(payload.poDateISO) : null,
        facilityId: payload.facilityId,
        status: payload.status,
        ...(justFinished ? { finishedAt: new Date() } : {}),
        notes: payload.notes?.trim() || null,
      },
    });

    for (const r of toRemove) await tx.lotLine.delete({ where: { id: r.id } }); // cascades its BOM

    let seq = 0;
    for (const l of lines) {
      const units = Math.max(0, Math.round(l.units));
      const writeMaterials = async (lotLineId: string, mats: { materialTypeId: string; perUnit: number }[]) => {
        await tx.lotMaterial.deleteMany({ where: { lotLineId } });
        for (const m of mats) {
          if (!m.materialTypeId || !(m.perUnit > 0)) continue;
          await tx.lotMaterial.create({
            data: {
              lotLineId,
              materialTypeId: m.materialTypeId,
              perUnit: m.perUnit,
              productId: m.materialTypeId === pouchId ? l.productId : null,
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
          : [
              ...(pouch ? [{ materialTypeId: pouch.id, perUnit: pouch.defaultPerUnit || 1 }] : []),
              ...(facilityUsesTeabag && teabag ? [{ materialTypeId: teabag.id, perUnit: teabag.defaultPerUnit || 15 }] : []),
            ];
        await writeMaterials(created.id, mats);
      }
      seq++;
    }
  });

  await recomputeAll();
  revalidatePath("/", "layout");
  return { ok: true as const };
}

