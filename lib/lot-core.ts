import "server-only";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { recomputeAll } from "@/lib/recompute";
import { checkOwned, type OwnedModel } from "@/lib/ownership";

/**
 * Lot-creation core, kept out of the "use server" action file on purpose.
 *
 * Exports in a "use server" module are callable RPC endpoints; this one must not be, because it
 * performs no permission check. The Lots page reaches it through the guarded createLot() action,
 * and PO creation reaches it directly (a caller who may create a PO shouldn't also need the lots
 * grant just because a PO happens to spin up a lot). The permission gate lives on each entry point,
 * never here.
 */

/** The default recipe for a new lot line: every material this facility actually stocks, at its
 *  default rate. Stock counts however it arrived — bought here, or transferred in from another
 *  facility. Deriving this from purchases alone gave a site fed only by transfers an empty bill
 *  of materials, so its lots recorded $0.00 material cost with nothing to raise a shortfall on. */
export async function defaultMaterialsFor(facilityId: string) {
  const [purchased, movedIn] = await Promise.all([
    prisma.purchase.findMany({
      where: { facilityId },
      select: { materialTypeId: true },
      distinct: ["materialTypeId"],
    }),
    prisma.stockMovement.findMany({
      where: { itemType: "RAW", toFacilityId: facilityId, materialTypeId: { not: null } },
      select: { materialTypeId: true },
      distinct: ["materialTypeId"],
    }),
  ]);
  const ids = [
    ...new Set([
      ...purchased.map((p) => p.materialTypeId),
      ...movedIn.map((m) => m.materialTypeId).filter((id): id is string => !!id),
    ]),
  ];
  if (ids.length === 0) return [];
  return prisma.materialType.findMany({ where: { id: { in: ids } } });
}

/** Smallest positive lot number not in use — deleted numbers get reused (e.g. a scrapped PO #21). */
export async function nextFreeLotNr(): Promise<number> {
  const used = new Set((await prisma.lot.findMany({ select: { lotNr: true } })).map((l) => l.lotNr));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** Create a new production lot with its SKU lines and default bill of materials. */
export async function createLotCore(input: {
  poNumber: string | null;
  poDateISO: string | null;
  facilityId: string;
  status: "IN_PRODUCTION" | "FINISHED";
  lines: { productId: string; units: number }[];
}) {
  const lines = input.lines.filter((l) => l.productId && l.units > 0);
  if (!input.facilityId || lines.length === 0) return { ok: false as const, error: "Pick a facility and at least one SKU with units" };

  // Every id the browser sent must belong to the caller's org — a foreign facility or product id
  // otherwise lands on the new lot and leaks that org's data back through nested reads.
  const bad = await checkOwned([
    ["facility", input.facilityId],
    ...lines.map((l) => ["product", l.productId] as [OwnedModel, string]),
  ]);
  if (bad) return bad;

  const lotNr = await nextFreeLotNr();

  const defaults = await defaultMaterialsFor(input.facilityId);

  const lot = await prisma.lot.create({
    data: {
      lotNr,
      poNumber: input.poNumber?.trim() || `#${lotNr}`,
      poDate: input.poDateISO ? new Date(input.poDateISO) : new Date(),
      facilityId: input.facilityId,
      status: input.status,
      finishedAt: input.status === "FINISHED" ? new Date() : null,
      lines: { create: lines.map((l, i) => ({ productId: l.productId, units: l.units, seq: i })) },
    },
    include: { lines: true },
  });

  for (const line of lot.lines) {
    for (const m of defaults) {
      await prisma.lotMaterial.create({
        data: {
          lotLineId: line.id,
          materialTypeId: m.id,
          perUnit: m.defaultPerUnit || 1,
          // Materials pooled per product (e.g. printed packaging) must carry the SKU.
          productId: m.skuSpecific ? line.productId : null,
        },
      });
    }
  }

  await recomputeAll();
  revalidatePath("/", "layout");
  return { ok: true as const, lotId: lot.id };
}
