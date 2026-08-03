"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { computeFinishedGoods } from "@/lib/queries";
import { requirePermission } from "@/lib/membership";
import { isDeadStatus } from "@/lib/shipment-mirror";
import { recomputeAll } from "@/lib/recompute";
import { upsertTransactionInvoice } from "@/app/transactions/actions";

/**
 * The batch-18 card (single-count plan §2d): confirm a live platform shipment into the ledger in
 * one click. Optionally finishes the in-production lots that produced the units (with a bundled
 * estimate invoice), then writes REAL movements from the chosen facility — capped at what that
 * facility physically holds (dry-run: the happy path never materializes a shortfall movement;
 * whatever production can't cover yet simply stays virtual) — and links them to the shipment so
 * the virtual drain retires.
 */
export async function recordShipmentHandoff(input: {
  shipmentId: string;
  facilityId: string; // where the units physically left from
  alsoFinishLotIds: string[];
  estimateAmount?: number | null;
}) {
  const gate = await requirePermission("shipments", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };

  const [shipment, facility] = await Promise.all([
    prisma.inboundShipment.findFirst({
      where: { id: input.shipmentId },
      include: { lines: true, links: { include: { movement: { select: { productId: true } } } } },
    }),
    prisma.facility.findFirst({ where: { id: input.facilityId } }),
  ]);
  if (!shipment) return { ok: false as const, error: "Shipment not found" };
  if (!facility) return { ok: false as const, error: "Facility not found" };
  if (facility.channel) return { ok: false as const, error: "Pick one of your own facilities, not a sales channel." };
  if (shipment.historical || shipment.ignored || isDeadStatus(shipment.extStatus)) {
    return { ok: false as const, error: "This shipment is no longer live — nothing to record." };
  }

  // Per SKU: what this shipment still has unaccounted (shipped − already linked).
  const linkedBySku = new Map<string, number>();
  for (const k of shipment.links) {
    if (k.movement.productId) linkedBySku.set(k.movement.productId, (linkedBySku.get(k.movement.productId) ?? 0) + k.qty);
  }
  const wanted = shipment.lines
    .filter((l) => l.productId)
    .map((l) => ({ productId: l.productId!, qty: Math.max(0, l.qtyShipped - (linkedBySku.get(l.productId!) ?? 0)) }))
    .filter((l) => l.qty > 1e-6);
  if (wanted.length === 0) return { ok: false as const, error: "Every unit on this shipment is already recorded." };

  // Finish the named lots first so their units are in the pool the dry-run sees.
  const finishIds: string[] = [];
  if (input.alsoFinishLotIds.length > 0) {
    const lots = await prisma.lot.findMany({ where: { id: { in: input.alsoFinishLotIds }, status: "IN_PRODUCTION" } });
    finishIds.push(...lots.map((l) => l.id));
    if (finishIds.length > 0) {
      await prisma.lot.updateMany({ where: { id: { in: finishIds } }, data: { status: "FINISHED", finishedAt: new Date() } });
    }
  }

  // Dry-run coverage against PHYSICAL pools (no virtual drains — we're replacing this shipment's
  // virtual with real movements; seeing it would double-subtract and always write zero).
  const { pools } = await computeFinishedGoods({ physicalOnly: true });
  const date = shipment.extCreatedAt ?? shipment.createdAt;
  const written: { productId: string; qty: number }[] = [];
  const leftVirtual: { productId: string; qty: number }[] = [];
  for (const w of wanted) {
    const avail = pools.find((p) => p.sku === w.productId && p.facilityId === input.facilityId)?.units ?? 0;
    const qty = Math.min(w.qty, avail);
    if (qty > 1e-6) {
      const mv = await prisma.stockMovement.create({
        data: {
          itemType: "FINISHED",
          productId: w.productId,
          quantity: qty,
          date,
          fromFacilityId: input.facilityId,
          toDestination: "AMAZON",
          source: "SHIPMENT_CONFIRM",
          notes: `Amazon shipment ${shipment.name ?? shipment.externalId}`,
        },
      });
      await prisma.movementShipmentLink.create({ data: { movementId: mv.id, shipmentId: shipment.id, qty } });
      written.push({ productId: w.productId, qty });
    }
    if (w.qty - qty > 1e-6) leftVirtual.push({ productId: w.productId, qty: w.qty - qty });
  }

  // Bundled estimate for the freshly-finished lots (the supplier invoices later — batch 18's shape).
  let estimateError: string | null = null;
  const estAmt = Number(input.estimateAmount) || 0;
  if (estAmt > 0 && finishIds.length > 0) {
    const lines = await prisma.lotLine.findMany({ where: { lotId: { in: finishIds } } });
    const unitsByLot = new Map<string, number>();
    for (const l of lines) unitsByLot.set(l.lotId, (unitsByLot.get(l.lotId) ?? 0) + l.units);
    const totalUnits = [...unitsByLot.values()].reduce((s, u) => s + u, 0) || 1;
    const supplier = await prisma.supplier.findFirst({ where: { facilityId: input.facilityId } });
    // Units-proportional split; the last line absorbs rounding so the lines reconcile exactly.
    const entries = [...unitsByLot.entries()];
    const amounts = entries.map(([, units]) => +((estAmt * units) / totalUnits).toFixed(2));
    amounts[amounts.length - 1] = +(estAmt - amounts.slice(0, -1).reduce((s, a) => s + a, 0)).toFixed(2);
    const res = await upsertTransactionInvoice({
      id: null,
      supplierName: supplier?.name ?? null,
      dateISO: new Date().toLocaleDateString("en-CA"),
      invoiceTotal: estAmt,
      isEstimate: true,
      lines: entries.map(([lotId], i) => ({
        category: "Production",
        amount: amounts[i],
        lotId,
        sku: null,
        concept: "Estimated production cost",
      })),
    });
    if (!res.ok) estimateError = res.error;
  }

  // Finishing lots / adding an estimate changes lot COG — recompute; movements alone don't.
  if (finishIds.length > 0 || (estAmt > 0 && !estimateError)) await recomputeAll();
  revalidatePath("/", "layout");
  return {
    ok: true as const,
    written: written.reduce((s, w) => s + w.qty, 0),
    leftVirtual: leftVirtual.reduce((s, w) => s + w.qty, 0),
    finishedLots: finishIds.length,
    warning: estimateError ? `Recorded, but the estimate failed: ${estimateError}` : null,
  };
}

/** Manually exclude a shipment from reconciliation (or bring it back). */
export async function setShipmentIgnored(shipmentId: string, ignored: boolean) {
  const gate = await requirePermission("shipments", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const s = await prisma.inboundShipment.findFirst({ where: { id: shipmentId } });
  if (!s) return { ok: false as const, error: "Shipment not found" };
  await prisma.inboundShipment.update({ where: { id: s.id }, data: { ignored } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Link an existing recorded movement to a shipment (attribution — retires the virtual drain). */
export async function linkShipmentToMovement(shipmentId: string, movementId: string) {
  const gate = await requirePermission("shipments", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const [shipment, movement] = await Promise.all([
    prisma.inboundShipment.findFirst({ where: { id: shipmentId }, include: { lines: true, links: { include: { movement: { select: { productId: true } } } } } }),
    prisma.stockMovement.findFirst({ where: { id: movementId }, include: { shipmentLinks: true } }),
  ]);
  if (!shipment || !movement) return { ok: false as const, error: "Not found" };
  if (!movement.productId || movement.toDestination !== "AMAZON") {
    return { ok: false as const, error: "Only finished-goods movements to Amazon can be linked." };
  }
  const line = shipment.lines.find((l) => l.productId === movement.productId);
  if (!line) return { ok: false as const, error: "That shipment doesn't carry this product." };
  const lineLinked = shipment.links
    .filter((k) => k.movement.productId === movement.productId)
    .reduce((s, k) => s + k.qty, 0);
  const movementLinked = movement.shipmentLinks.reduce((s, k) => s + k.qty, 0);
  const qty = Math.min(line.qtyShipped - lineLinked, movement.quantity - movementLinked);
  if (qty <= 1e-6) return { ok: false as const, error: "Nothing left to link on one of the sides." };
  await prisma.movementShipmentLink.create({ data: { movementId, shipmentId, qty } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * One-click reversal for a cancelled shipment that had linked movements: card-written movements
 * are deleted outright (restoring the pool); hand-recorded ones just lose the link (the operator
 * decides their fate). The shipment is then ignored so it stops demanding attention.
 */
export async function reverseCancelledShipment(shipmentId: string) {
  const gate = await requirePermission("shipments", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const shipment = await prisma.inboundShipment.findFirst({
    where: { id: shipmentId },
    include: { links: { include: { movement: true } } },
  });
  if (!shipment) return { ok: false as const, error: "Shipment not found" };
  if (!isDeadStatus(shipment.extStatus)) {
    return { ok: false as const, error: "This shipment isn't cancelled — nothing to reverse." };
  }
  let deleted = 0;
  let unlinked = 0;
  for (const k of shipment.links) {
    if (k.movement.source === "SHIPMENT_CONFIRM") {
      await prisma.stockMovement.delete({ where: { id: k.movementId } }); // links cascade
      deleted++;
    } else {
      await prisma.movementShipmentLink.delete({ where: { id: k.id } });
      unlinked++;
    }
  }
  await prisma.inboundShipment.update({ where: { id: shipment.id }, data: { ignored: true } });
  revalidatePath("/", "layout");
  return { ok: true as const, deleted, unlinked };
}
