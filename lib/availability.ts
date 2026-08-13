import "server-only";
import { prisma } from "@/lib/prisma";
import { isLayerKind } from "@/lib/constants";
import { appearedAt } from "@/lib/lot-status";
import { buildTimeline, capOn, type AvailabilityEvent } from "@/lib/availability-math";

/**
 * Everything that ever changed a stock balance at the org's OWN facilities, as dated events —
 * the raw material for "what was here on this day". Mirrors the costing engines' rules exactly:
 * finished units appear when their lot line FINISHES (lib/lot-status appearedAt); raw materials
 * arrive on their purchase date and are consumed at the lot's PO date (a run eats materials
 * while it's made); layer movements (starting balances, found stock, returns) arrive on their
 * movement date; transfers leave one facility and land at another on the movement date.
 */

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function getAvailabilityEvents(): Promise<AvailabilityEvent[]> {
  const [lots, movements, purchases] = await Promise.all([
    prisma.lot.findMany({
      include: { lines: { include: { materials: { include: { materialType: { select: { skuSpecific: true } } } } } } },
    }),
    prisma.stockMovement.findMany(),
    prisma.purchase.findMany(),
  ]);

  const out: AvailabilityEvent[] = [];

  for (const lot of lots) {
    const consumedAt = day(lot.poDate ?? lot.createdAt);
    for (const ln of lot.lines) {
      if (ln.status === "FINISHED") {
        out.push({
          kind: "FINISHED",
          itemId: ln.productId,
          poolSku: null,
          facilityId: lot.facilityId,
          date: day(appearedAt(ln, lot)),
          delta: ln.units,
        });
      }
      for (const m of ln.materials) {
        out.push({
          kind: "RAW",
          itemId: m.materialTypeId,
          poolSku: m.materialType.skuSpecific ? (m.productId ?? ln.productId) : null,
          facilityId: lot.facilityId,
          date: consumedAt,
          delta: -(ln.units * m.perUnit),
        });
      }
    }
  }

  for (const p of purchases) {
    // Positive adjustment rows are excluded from supply by the engine; legacy negative ones
    // (lost inventory) consume — mirror both so the balances match the pools.
    if (p.isAdjustment && p.quantity > 0) continue;
    out.push({
      kind: "RAW",
      itemId: p.materialTypeId,
      poolSku: p.productId ?? null,
      facilityId: p.facilityId,
      date: day(p.date),
      delta: p.quantity,
    });
  }

  for (const m of movements) {
    const d = day(m.date);
    const kind = m.itemType === "RAW" ? ("RAW" as const) : ("FINISHED" as const);
    const itemId = kind === "RAW" ? m.materialTypeId : m.productId;
    if (!itemId) continue;
    const poolSku = kind === "RAW" ? (m.productId ?? null) : null;
    // Anything landing AT one of your facilities counts in: transfers, layer rows (starting
    // balance / found / return), channel pull-backs.
    if (m.toFacilityId) out.push({ kind, itemId, poolSku, facilityId: m.toFacilityId, date: d, delta: m.quantity });
    // Anything leaving one of your facilities counts out. A channel pull-back's fromFacilityId
    // is the CHANNEL's locked facility (a history stamp), not a stock source — skip those.
    if (m.fromFacilityId && !m.fromDestination && !isLayerKind(m.kind)) {
      out.push({ kind, itemId, poolSku, facilityId: m.fromFacilityId, date: d, delta: -m.quantity });
    }
  }

  return out;
}

/** The most units a new movement may take from `facilityId` on `dateISO` — the server-side twin
 *  of the form's calendar/cap logic, enforced at save time. */
export async function maxMovableOn(params: {
  kind: "FINISHED" | "RAW";
  itemId: string;
  poolSku: string | null;
  facilityId: string;
  dateISO: string;
}): Promise<number> {
  const events = await getAvailabilityEvents();
  const timeline = buildTimeline(
    events.filter(
      (e) =>
        e.kind === params.kind &&
        e.itemId === params.itemId &&
        e.facilityId === params.facilityId &&
        (e.poolSku ?? null) === (params.poolSku ?? null),
    ),
  );
  return capOn(timeline, params.dateISO);
}
