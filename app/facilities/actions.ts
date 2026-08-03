"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { computeFinishedGoods, getInventory } from "@/lib/queries";
import { allowedDestinations } from "@/lib/destinations";
import { checkOwned } from "@/lib/ownership";
import { requirePermission } from "@/lib/membership";

/** Create a facility — a co-packer, warehouse, 3PL or anywhere else stock lives. */
export async function createFacility(input: { code: string; name: string; type: string }) {
  const gate = await requirePermission("facilities", "create");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const code = input.code.trim().toUpperCase().replace(/\s+/g, "");
  const name = input.name.trim();
  if (!code) return { ok: false as const, error: "Short code required" };
  if (!name) return { ok: false as const, error: "Name required" };

  const clash = await prisma.facility.findFirst({ where: { code } });
  if (clash) return { ok: false as const, error: `Code ${code} already exists` };

  if (input.type === "channel") return { ok: false as const, error: "Channel facilities are created by connecting an integration." };
  const f = await prisma.facility.create({ data: { code, name, type: input.type || "co-packer" } });
  revalidatePath("/", "layout");
  return { ok: true as const, id: f.id };
}

/** Edit a facility's details. `legalName`/`address` are what get printed on purchase orders.
 *  `supplierId` is the same link the supplier page offers, editable from this side too:
 *  which supplier profile *is* this facility (null = it isn't a vendor you pay). */
export async function updateFacility(input: {
  id: string;
  code: string;
  name: string;
  type: string;
  legalName: string;
  address: string;
  notes: string;
  supplierId?: string | null;
}) {
  const gate = await requirePermission("facilities", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const code = input.code.trim().toUpperCase().replace(/\s+/g, "");
  const name = input.name.trim();
  if (!code) return { ok: false as const, error: "Short code required" };
  if (!name) return { ok: false as const, error: "Name required" };

  const current = await prisma.facility.findFirst({ where: { id: input.id } });
  if (!current) return { ok: false as const, error: "Facility not found" };
  if (current.locked) return { ok: false as const, error: "This facility is managed by an integration and can't be edited here." };
  if (code !== current.code) {
    const clash = await prisma.facility.findFirst({ where: { code } });
    if (clash) return { ok: false as const, error: `Code ${code} already exists` };
  }

  await prisma.facility.update({
    where: { id: input.id },
    data: {
      code,
      name,
      type: input.type || "co-packer",
      legalName: input.legalName.trim() || null,
      address: input.address.trim() || null,
      notes: input.notes.trim() || null,
    },
  });

  // Supplier link — the mirror of the picker on the supplier page. A facility can be claimed by
  // at most one supplier profile, so unlink the previous holder before linking the new one.
  if (input.supplierId !== undefined) {
    const current = await prisma.supplier.findFirst({ where: { facilityId: input.id } });
    const next = input.supplierId || null;
    if (current?.id !== next) {
      if (current) await prisma.supplier.update({ where: { id: current.id }, data: { facilityId: null } });
      if (next) await prisma.supplier.update({ where: { id: next }, data: { facilityId: input.id } });
    }
  }

  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Delete a facility — refused while any lot, purchase, PO or stock movement still points at it.
 *  A supplier profile linked to it is simply unlinked (the FK is set-null). */
export async function deleteFacility(id: string) {
  const gate = await requirePermission("facilities", "delete");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const facility = await prisma.facility.findFirst({ where: { id } });
  if (!facility) return { ok: false as const, error: "Facility not found" };
  if (facility.locked) return { ok: false as const, error: "This facility is managed by an integration and can't be deleted." };

  // Movements count on BOTH sides. A 3PL you only ever ship *to* has no lots, purchases or POs,
  // so without this it looks freely deletable — and deleting it nulls `toFacilityId` on every
  // inbound transfer, which drops that stock out of the ledger entirely.
  const [lots, purchases, purchaseOrders, movementsFrom, movementsTo] = await Promise.all([
    prisma.lot.count({ where: { facilityId: id } }),
    prisma.purchase.count({ where: { facilityId: id } }),
    prisma.purchaseOrder.count({ where: { facilityId: id } }),
    prisma.stockMovement.count({ where: { fromFacilityId: id } }),
    prisma.stockMovement.count({ where: { toFacilityId: id } }),
  ]);
  if (lots + purchases + purchaseOrders + movementsFrom + movementsTo > 0) {
    return { ok: false as const, error: "This facility is in use and can no longer be deleted." };
  }

  await prisma.facility.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export type MovementInput = {
  itemType: "FINISHED" | "RAW";
  productId: string | null; // FINISHED: the SKU. RAW sku-specific: the pool SKU. Else null.
  materialTypeId: string | null; // RAW only.
  quantity: number;
  dateISO: string | null;
  fromFacilityId: string;
  /** Either another of your facilities, or a destination outside your network — not both. */
  toFacilityId: string | null;
  toDestination: string | null;
  notes: string | null;
  /** Optional: the live platform shipment these units are on — links the movement so the
   *  reconciliation layer knows this handoff is recorded (finished goods → AMAZON only). */
  shipmentId?: string | null;
};

/** Record stock leaving one of your locations — finished goods or raw materials. */
export async function createMovement(input: MovementInput) {
  const gate = await requirePermission("facilities", "create");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  if (input.itemType !== "RAW" && input.itemType !== "FINISHED") {
    return { ok: false as const, error: "Unknown item type" };
  }
  const raw = input.itemType === "RAW";
  const quantity = Number(input.quantity);
  // `> 0` alone lets Infinity through, and NaN would slip past a `<= 0` test.
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false as const, error: "Enter how many units moved" };
  }
  if (!input.fromFacilityId) return { ok: false as const, error: "Pick where the stock is moving from" };
  if (raw && !input.materialTypeId) return { ok: false as const, error: "Pick a raw material" };
  if (!raw && !input.productId) return { ok: false as const, error: "Pick a product" };

  // Ids arrive from the browser: confirm each one is this organization's before storing it.
  const owned = await checkOwned([
    ["facility", input.fromFacilityId],
    ["facility", input.toFacilityId],
    ["product", input.productId],
    ["material", raw ? input.materialTypeId : null],
  ]);
  if (owned) return owned;

  const toFacilityId = input.toFacilityId || null;
  const toDestination = input.toDestination || null;
  if (!toFacilityId && !toDestination) return { ok: false as const, error: "Pick a destination" };
  if (toFacilityId && toDestination) return { ok: false as const, error: "Pick either a facility or a destination, not both" };
  if (toFacilityId && toFacilityId === input.fromFacilityId) {
    return { ok: false as const, error: "Source and destination facility are the same" };
  }
  // A raw material can only be transferred or written off — never sold or fulfilled.
  if (toDestination && !allowedDestinations(input.itemType).includes(toDestination)) {
    return {
      ok: false as const,
      error: raw ? "Raw materials can only move to another facility or be written off." : "Unknown destination",
    };
  }

  // Warn (don't block) when the ledger doesn't show enough stock — the count may just be behind.
  let onHand = 0;
  if (raw) {
    const { pools } = await getInventory();
    // materialCode is what pools key by; look it up from the material id.
    const mat = await prisma.materialType.findFirst({ where: { id: input.materialTypeId! }, select: { code: true } });
    const fromFac = await prisma.facility.findFirst({ where: { id: input.fromFacilityId }, select: { code: true } });
    const poolSkuCode = input.productId
      ? (await prisma.product.findFirst({ where: { id: input.productId }, select: { code: true } }))?.code ?? null
      : null;
    onHand =
      pools.find(
        (p) => p.materialCode === mat?.code && p.facility === fromFac?.code && (p.sku ?? null) === poolSkuCode,
      )?.quantityRemaining ?? 0;
  } else {
    const { pools } = await computeFinishedGoods();
    onHand = pools.find((p) => p.sku === input.productId && p.facilityId === input.fromFacilityId)?.units ?? 0;
  }

  const created = await prisma.stockMovement.create({
    data: {
      itemType: input.itemType,
      productId: input.productId || null,
      materialTypeId: raw ? input.materialTypeId : null,
      quantity,
      date: input.dateISO ? new Date(input.dateISO) : new Date(),
      fromFacilityId: input.fromFacilityId,
      toFacilityId,
      toDestination,
      notes: input.notes?.trim().slice(0, 500) || null,
    },
  });

  // Link to the platform shipment when one was picked — best-effort attribution: the movement is
  // recorded either way; a bad link choice must never block the ledger entry.
  if (input.shipmentId && !raw && toDestination === "AMAZON" && input.productId) {
    const shipment = await prisma.inboundShipment.findFirst({
      where: { id: input.shipmentId },
      include: { lines: true, links: { include: { movement: { select: { productId: true } } } } },
    });
    const line = shipment?.lines.find((l) => l.productId === input.productId);
    if (shipment && line) {
      const already = shipment.links
        .filter((k) => k.movement.productId === input.productId)
        .reduce((s, k) => s + k.qty, 0);
      const qty = Math.min(quantity, Math.max(0, line.qtyShipped - already));
      if (qty > 1e-6) {
        await prisma.movementShipmentLink.create({ data: { movementId: created.id, shipmentId: shipment.id, qty } });
      }
    }
  }

  revalidatePath("/", "layout");
  return {
    ok: true as const,
    warning:
      quantity > onHand
        ? `Recorded, but that location only shows ${Math.round(onHand).toLocaleString()} on hand — it's now short by ${Math.round(quantity - onHand).toLocaleString()}.`
        : null,
  };
}

/** Remove a movement (nothing depends on it — the engine just replays without it). */
export async function deleteMovement(id: string) {
  const gate = await requirePermission("facilities", "delete");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  await prisma.stockMovement.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
