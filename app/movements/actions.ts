"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { computeFinishedGoods } from "@/lib/queries";
import { DESTINATIONS } from "@/lib/destinations";

export type MovementInput = {
  productId: string;
  quantity: number;
  dateISO: string | null;
  fromFacilityId: string;
  /** Either another of your facilities, or a destination outside your network — not both. */
  toFacilityId: string | null;
  toDestination: string | null;
  notes: string | null;
};

/** Record finished stock leaving one of your locations. */
export async function createMovement(input: MovementInput) {
  const quantity = Math.round(Number(input.quantity) || 0);
  if (quantity <= 0) return { ok: false as const, error: "Enter how many units moved" };
  if (!input.productId) return { ok: false as const, error: "Pick a product" };
  if (!input.fromFacilityId) return { ok: false as const, error: "Pick where the stock is moving from" };

  const toFacilityId = input.toFacilityId || null;
  const toDestination = input.toDestination || null;
  if (!toFacilityId && !toDestination) return { ok: false as const, error: "Pick a destination" };
  if (toFacilityId && toDestination) return { ok: false as const, error: "Pick either a facility or a destination, not both" };
  if (toFacilityId && toFacilityId === input.fromFacilityId) {
    return { ok: false as const, error: "Source and destination facility are the same" };
  }
  if (toDestination && !DESTINATIONS.some((d) => d.value === toDestination)) {
    return { ok: false as const, error: "Unknown destination" };
  }

  // Warn (don't block) when the ledger doesn't show enough stock — the count may just be behind.
  const { pools } = await computeFinishedGoods();
  const onHand = pools.find((p) => p.sku === input.productId && p.facilityId === input.fromFacilityId)?.units ?? 0;

  await prisma.stockMovement.create({
    data: {
      productId: input.productId,
      quantity,
      date: input.dateISO ? new Date(input.dateISO) : new Date(),
      fromFacilityId: input.fromFacilityId,
      toFacilityId,
      toDestination,
      notes: input.notes?.trim() || null,
    },
  });

  revalidatePath("/", "layout");
  return {
    ok: true as const,
    warning:
      quantity > onHand
        ? `Recorded, but that location only shows ${Math.round(onHand).toLocaleString()} units on hand — it's now short by ${Math.round(quantity - onHand).toLocaleString()}.`
        : null,
  };
}

/** Remove a movement (nothing depends on it — the engine just replays without it). */
export async function deleteMovement(id: string) {
  await prisma.stockMovement.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
