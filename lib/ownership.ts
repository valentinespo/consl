import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Ownership checks for client-supplied ids.
 *
 * The tenant extension stamps every new row with the caller's organization and filters every
 * read by it — but it cannot vet the ids *inside* a write. A server action is a directly
 * callable endpoint, so `createMovement({ fromFacilityId })` will happily store another org's
 * facility id on a row that belongs to the caller. The foreign key resolves, nested `include`s
 * are not tenant-filtered, and the other org's data leaks into this one's UI.
 *
 * Every id that arrives from the browser goes through here before it reaches the database.
 */

// Each delegate is reached through the scoped client, so `findFirst` gets an orgId filter injected.
const DELEGATES = {
  facility: () => prisma.facility,
  product: () => prisma.product,
  material: () => prisma.materialType,
  supplier: () => prisma.supplier,
  lot: () => prisma.lot,
  purchaseInvoice: () => prisma.purchaseInvoice,
  transactionInvoice: () => prisma.transactionInvoice,
  purchaseOrder: () => prisma.purchaseOrder,
} as const;

export type OwnedModel = keyof typeof DELEGATES;

const LABEL: Record<OwnedModel, string> = {
  facility: "facility",
  product: "product",
  material: "raw material",
  supplier: "supplier",
  lot: "production lot",
  purchaseInvoice: "purchase invoice",
  transactionInvoice: "transaction invoice",
  purchaseOrder: "purchase order",
};

type Finder = { findFirst(args: unknown): Promise<{ id: string } | null> };

/** True when `id` names a row of `model` that belongs to the caller's organization. */
export async function owns(model: OwnedModel, id: string | null | undefined): Promise<boolean> {
  if (!id) return false;
  const row = await (DELEGATES[model]() as unknown as Finder).findFirst({
    where: { id },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Check every supplied id in one round of queries. Blank ids are skipped — use this for
 * optional references and validate required ones separately.
 * Returns null when everything checks out, or a ready-to-return error result.
 */
export async function checkOwned(
  refs: Array<[OwnedModel, string | null | undefined]>,
): Promise<{ ok: false; error: string } | null> {
  const present = refs.filter(([, id]) => !!id);
  if (present.length === 0) return null;
  const results = await Promise.all(present.map(([model, id]) => owns(model, id)));
  const bad = results.findIndex((r) => !r);
  if (bad === -1) return null;
  return { ok: false as const, error: `That ${LABEL[present[bad][0]]} no longer exists.` };
}
