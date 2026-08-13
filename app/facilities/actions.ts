"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { computeFinishedGoods, getInventory } from "@/lib/queries";
import { allowedDestinations } from "@/lib/destinations";
import { checkOwned } from "@/lib/ownership";
import { requirePermission } from "@/lib/membership";
import { isLayerKind } from "@/lib/constants";
import { recomputeAll } from "@/lib/recompute";

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
  /** Where the stock comes from: one of your facilities, OR a sales channel it's being pulled
   *  back from (an Amazon removal order into your own warehouse). Exactly one is set. */
  fromFacilityId: string | null;
  fromDestination?: string | null; // AMAZON | SHOPIFY | TIKTOK — finished goods only
  /** Either another of your facilities, or a destination outside your network — not both. */
  toFacilityId: string | null;
  toDestination: string | null;
  /** Stock APPEARING at a facility with a typed cost — a found-stock correction or a customer
   *  return. No source; becomes a FIFO layer exactly like an onboarding starting balance. */
  adjustment?: { reason: "FOUND" | "RETURN"; unitCost: number } | null;
  notes: string | null;
};

const CHANNEL_SOURCES = ["AMAZON", "SHOPIFY", "TIKTOK"];

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
  // Adjustments have no source — validate and record them on their own path.
  const adjustment = input.adjustment ?? null;
  if (adjustment) {
    if (adjustment.reason !== "FOUND" && adjustment.reason !== "RETURN") {
      return { ok: false as const, error: "Unknown adjustment type" };
    }
    if (raw && adjustment.reason === "RETURN") {
      return { ok: false as const, error: "Customers only ever return finished products." };
    }
    if (raw && !input.materialTypeId) return { ok: false as const, error: "Pick a raw material" };
    if (!raw && !input.productId) return { ok: false as const, error: "Pick a product" };
    const unitCost = Number(adjustment.unitCost);
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      return { ok: false as const, error: "Enter what one unit cost you" };
    }
    if (!input.toFacilityId) return { ok: false as const, error: "Pick which facility received the stock" };
    const adjOwned = await checkOwned([
      ["facility", input.toFacilityId],
      ["product", input.productId],
      ["material", raw ? input.materialTypeId : null],
    ]);
    if (adjOwned) return adjOwned;
    const target = await prisma.facility.findFirst({ where: { id: input.toFacilityId }, select: { channel: true } });
    if (target?.channel) {
      return { ok: false as const, error: "Channel stock is counted by the platform itself — adjustments only apply to your own facilities." };
    }
    await prisma.stockMovement.create({
      data: {
        kind: adjustment.reason === "FOUND" ? "ADJUST_FOUND" : "ADJUST_RETURN",
        itemType: input.itemType,
        productId: input.productId || null,
        materialTypeId: raw ? input.materialTypeId : null,
        quantity,
        unitCost,
        date: input.dateISO ? new Date(input.dateISO) : new Date(),
        toFacilityId: input.toFacilityId,
        notes: input.notes?.trim().slice(0, 500) || null,
      },
    });
    // A raw layer feeds production costing — refresh the persisted lot snapshots.
    if (raw) await recomputeAll();
    revalidatePath("/", "layout");
    return { ok: true as const, warning: null };
  }

  const fromDestination = input.fromDestination || null;
  if (fromDestination) {
    // Stock leaving a sales channel — finished goods only. It may land at one of your facilities
    // or at ANOTHER channel (AWD → your Shopify 3PL). Sold/lost stock at a channel is NOT recorded
    // here: the channel's own reported count already drops, so there's nothing to move.
    if (raw) return { ok: false as const, error: "Raw materials never sit at a sales channel." };
    if (!CHANNEL_SOURCES.includes(fromDestination)) return { ok: false as const, error: "Unknown channel" };
    if (input.toDestination === "CUSTOMER" || input.toDestination === "LOSS") {
      return { ok: false as const, error: "Stock sold or lost at a channel leaves its count on its own — nothing to record." };
    }
    if (input.toDestination === fromDestination) return { ok: false as const, error: "Source and destination channel are the same" };
    // An accompanying facility id names the SPECIFIC place at the channel ("Shopify — Alton
    // Place") — history only; the cost still draws from the channel's shared pool.
    if (input.fromFacilityId) {
      const src = await prisma.facility.findFirst({ where: { id: input.fromFacilityId }, select: { channel: true } });
      const root = src?.channel ? (src.channel.startsWith("AMAZON") ? "AMAZON" : src.channel) : null;
      if (root !== fromDestination) return { ok: false as const, error: "That location doesn't belong to this channel." };
    }
  } else if (!input.fromFacilityId) {
    return { ok: false as const, error: "Pick where the stock is moving from" };
  }
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
  // Channel sources skip the check: the channel's own reported count is synced, not ledger-held.
  let onHand = quantity;
  if (fromDestination) {
    // no ledger to check against
  } else if (raw) {
    const { pools } = await getInventory();
    // materialCode is what pools key by; look it up from the material id.
    const mat = await prisma.materialType.findFirst({ where: { id: input.materialTypeId! }, select: { code: true } });
    const fromFac = await prisma.facility.findFirst({ where: { id: input.fromFacilityId! }, select: { code: true } });
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

  await prisma.stockMovement.create({
    data: {
      itemType: input.itemType,
      productId: input.productId || null,
      materialTypeId: raw ? input.materialTypeId : null,
      quantity,
      date: input.dateISO ? new Date(input.dateISO) : new Date(),
      fromFacilityId: input.fromFacilityId || null,
      fromDestination,
      toFacilityId,
      toDestination,
      notes: input.notes?.trim().slice(0, 500) || null,
    },
  });

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
  const row = await prisma.stockMovement.findFirst({ where: { id }, select: { kind: true, itemType: true } });
  await prisma.stockMovement.delete({ where: { id } });
  // Removing a raw layer (starting balance / found stock) changes what production consumed —
  // refresh the cost snapshots so every lot's numbers re-derive without it.
  if (row && isLayerKind(row.kind) && row.itemType === "RAW") await recomputeAll();
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Starting balances — day-zero FIFO layers created during onboarding (or corrected later).
 *
 * Each call REPLACES the opening rows of that item type at that facility, so the wizard's grid is
 * idempotent: re-saving with edited numbers rewrites the balance instead of stacking layers.
 * Finished units are costed at each SKU's onboarding COG (Product.openingUnitCost); raw materials
 * carry the cost entered on each line, since they never came from a purchase.
 */
export async function saveFinishedOpenings(facilityId: string, rows: { productId: string; units: number }[]) {
  const gate = await requirePermission("facilities", "create");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const facility = await prisma.facility.findFirst({ where: { id: facilityId } });
  if (!facility) return { ok: false as const, error: "Facility not found" };
  if (facility.channel) return { ok: false as const, error: "Channel stock is counted automatically — starting balances only apply to your own facilities." };

  const products = await prisma.product.findMany({ select: { id: true, openingUnitCost: true } });
  const costById = new Map(products.map((p) => [p.id, p.openingUnitCost ?? 0]));
  const clean = rows
    .map((r) => ({ productId: r.productId, units: Math.floor(Number(r.units) || 0) }))
    .filter((r) => costById.has(r.productId) && r.units > 0);

  await prisma.$transaction(async (tx) => {
    await tx.stockMovement.deleteMany({ where: { kind: "OPENING", itemType: "FINISHED", toFacilityId: facilityId } });
    for (const r of clean) {
      await tx.stockMovement.create({
        data: {
          kind: "OPENING",
          itemType: "FINISHED",
          productId: r.productId,
          quantity: r.units,
          unitCost: costById.get(r.productId) ?? 0,
          date: new Date(),
          toFacilityId: facilityId,
          notes: "Starting balance",
        },
      });
    }
  });
  revalidatePath("/", "layout");
  return { ok: true as const, saved: clean.length };
}

export async function saveRawOpenings(
  facilityId: string,
  rows: { materialTypeId: string; productId: string | null; quantity: number; unitCost: number }[],
) {
  const gate = await requirePermission("facilities", "create");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const facility = await prisma.facility.findFirst({ where: { id: facilityId } });
  if (!facility) return { ok: false as const, error: "Facility not found" };
  if (facility.channel) return { ok: false as const, error: "Raw materials can't sit at a sales channel." };

  const materials = await prisma.materialType.findMany({ select: { id: true, skuSpecific: true } });
  const products = await prisma.product.findMany({ select: { id: true } });
  const matById = new Map(materials.map((m) => [m.id, m]));
  const productIds = new Set(products.map((p) => p.id));
  const clean = rows
    .map((r) => ({
      materialTypeId: r.materialTypeId,
      productId: r.productId && productIds.has(r.productId) ? r.productId : null,
      quantity: Number(r.quantity) || 0,
      unitCost: Number(r.unitCost) || 0,
    }))
    .filter((r) => {
      const mat = matById.get(r.materialTypeId);
      if (!mat || !(r.quantity > 0) || r.unitCost < 0) return false;
      return mat.skuSpecific ? !!r.productId : true; // per-SKU materials need their pool SKU
    });

  await prisma.$transaction(async (tx) => {
    await tx.stockMovement.deleteMany({ where: { kind: "OPENING", itemType: "RAW", toFacilityId: facilityId } });
    for (const r of clean) {
      await tx.stockMovement.create({
        data: {
          kind: "OPENING",
          itemType: "RAW",
          materialTypeId: r.materialTypeId,
          productId: r.productId,
          quantity: r.quantity,
          unitCost: r.unitCost,
          date: new Date(),
          toFacilityId: facilityId,
          notes: "Starting balance",
        },
      });
    }
  });
  // Raw layers feed production costing — refresh the persisted snapshots.
  await recomputeAll();
  revalidatePath("/", "layout");
  return { ok: true as const, saved: clean.length };
}
