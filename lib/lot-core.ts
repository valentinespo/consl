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

/** The recipe a NEW line for each product starts with: a copy of that SKU's most recent lot
 *  line's bill of materials (same materials, same per-unit rates), or NOTHING when the SKU has
 *  never been in a lot — the operator builds the first recipe by hand and every later lot
 *  inherits it. "Most recent" = newest PO date (then creation time), across ALL facilities: the
 *  recipe follows the SKU, not the building; missing stock at the new facility surfaces as a
 *  normal shortfall. Replaces the old facility-defaults seeding, which stamped every material
 *  the facility had ever stocked onto unrelated SKUs. */
export async function bomFromLatestLine(
  productIds: string[],
): Promise<Map<string, { materialTypeId: string; perUnit: number; skuSpecific: boolean }[]>> {
  const map = new Map<string, { materialTypeId: string; perUnit: number; skuSpecific: boolean }[]>();
  const ids = [...new Set(productIds)].filter(Boolean);
  if (ids.length === 0) return map;
  const lines = await prisma.lotLine.findMany({
    where: { productId: { in: ids } },
    select: {
      productId: true,
      createdAt: true,
      lot: { select: { poDate: true, createdAt: true } },
      materials: { select: { materialTypeId: true, perUnit: true, materialType: { select: { skuSpecific: true } } } },
    },
  });
  const stamp = (l: (typeof lines)[number]) =>
    [l.lot.poDate?.getTime() ?? 0, l.lot.createdAt.getTime(), l.createdAt.getTime()] as const;
  const newer = (a: readonly number[], b: readonly number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };
  const best = new Map<string, (typeof lines)[number]>();
  for (const l of lines) {
    const cur = best.get(l.productId);
    if (!cur || newer(stamp(l), stamp(cur))) best.set(l.productId, l);
  }
  for (const [pid, l] of best)
    map.set(
      pid,
      l.materials.map((m) => ({ materialTypeId: m.materialTypeId, perUnit: m.perUnit, skuSpecific: m.materialType.skuSpecific })),
    );
  return map;
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

  // Resolved BEFORE the lot exists — otherwise each just-created (still material-less) line would
  // itself be the SKU's "latest line" and every new lot would inherit an empty recipe.
  const inherited = await bomFromLatestLine(lines.map((l) => l.productId));

  // Status lives on each LINE (SKUs finish independently); the lot columns are a derived cache.
  const finishedAt = input.status === "FINISHED" ? new Date() : null;
  const lot = await prisma.lot.create({
    data: {
      lotNr,
      poNumber: input.poNumber?.trim() || `#${lotNr}`,
      poDate: input.poDateISO ? new Date(input.poDateISO) : new Date(),
      facilityId: input.facilityId,
      status: input.status,
      finishedAt,
      lines: {
        create: lines.map((l, i) => ({ productId: l.productId, units: l.units, seq: i, status: input.status, finishedAt })),
      },
    },
    include: { lines: true },
  });

  for (const line of lot.lines) {
    for (const m of inherited.get(line.productId) ?? []) {
      await prisma.lotMaterial.create({
        data: {
          lotLineId: line.id,
          materialTypeId: m.materialTypeId,
          perUnit: m.perUnit,
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
