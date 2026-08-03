import { prisma } from "@/lib/prisma";
import { isDeadStatus } from "@/lib/shipment-mirror";
import type { FinishedSupply, FinishedMovement } from "@/lib/finished-goods";

/**
 * The virtual handoff — the single-count correctness core (plan §2b).
 *
 * A LIVE mirrored shipment proves units left the seller's network even when nobody recorded a
 * movement: Amazon's snapshot already counts them, so the same units must stop counting in our
 * pools / in-production. That drain is computed here as per-SKU VIRTUAL movements at read time —
 * nothing is written. Consumed in lockstep by BOTH stock builders (lib/restock.ts getRestock and
 * lib/queries.ts computeFinishedGoods); they must never diverge, so all rules live in this file.
 *
 * Netting is structural, matcher-independent: per SKU,
 *   virtual = max(0, cappedShipped − linked qty − unlinked AMAZON movements that plausibly cover)
 * so a hand-recorded but never-linked movement can never double-drain. "Plausibly covers" is
 * (a) dated within ±30d of a counting shipment's effective date, or (b) for shipments first seen
 * during the org's initial mirror backfill (adoption era), ANY movement dated before
 * reconcileSince — mid-flight shipments discovered on day one were inevitably already recorded by
 * hand under whatever date the operator's old books used (FBA's v0 API reports no creation date,
 * so effective dates of backfilled shipments are first-seen, far from the hand-records).
 * Over-netting degrades to today's status quo (no drain); under-netting would double-drain — so
 * netting is deliberately generous. Epsilon: qty ≤ 1e-6 is zero.
 */

const EPS = 1e-6;
const DAY = 86_400_000;
/** Amazon has started receiving (or reported receipts) — the pre-receipt inbound cap no longer applies. */
const RECEIPT_STARTED = new Set(["RECEIVING", "DELIVERED", "CHECKED_IN", "CLOSED"]);
/** Shipments first seen within this many ms of reconcileSince belong to the initial backfill. */
const ADOPTION_WINDOW = 2 * DAY;

export type HandoffPlan = {
  /** Per productId: units to drain virtually, and the replay date (max counting-shipment eff date). */
  bySku: Map<string, { qty: number; effMs: number; shipmentIds: string[] }>;
  /** Total units across all SKUs (0 ⇒ no virtual movements at all). */
  totalUnits: number;
  /** Last mirror outcome — non-"ok" drives the degraded-mode banner. Null = no Amazon connection. */
  shipmentSyncStatus: string | null;
};

const EMPTY: HandoffPlan = { bySku: new Map(), totalUnits: 0, shipmentSyncStatus: null };

/** Compute the org's virtual-handoff plan. Read-only; org-scoped via the tenant client. */
export async function getHandoffPlan(): Promise<HandoffPlan> {
  const conn = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn) return EMPTY;

  const [shipments, amazonMovements, snaps] = await Promise.all([
    prisma.inboundShipment.findMany({
      where: { platform: "amazon", historical: false, ignored: false },
      include: {
        lines: true,
        links: { include: { movement: { select: { productId: true } } } },
      },
    }),
    prisma.stockMovement.findMany({
      where: { itemType: "FINISHED", toDestination: "AMAZON" },
      include: { shipmentLinks: { select: { id: true } } },
    }),
    prisma.skuSnapshot.findMany({ distinct: ["productId"], orderBy: { capturedAt: "desc" } }),
  ]);

  // Counting set: live, seller-origin, synced-marketplace, any status except never-moved terminals
  // — INCLUDING CLOSED forever (received units stay inside Amazon's totals, the drain persists).
  const counting = shipments.filter(
    (s) =>
      !isDeadStatus(s.extStatus) &&
      s.origin !== "AMAZON" &&
      (!s.marketplaceId || !conn.marketplaceId || s.marketplaceId === conn.marketplaceId),
  );
  if (counting.length === 0) return { ...EMPTY, shipmentSyncStatus: conn.shipmentSyncStatus };

  const snapBySku = new Map(snaps.map((s) => [s.productId, s]));
  const reconcileMs = (conn.reconcileSince ?? new Date(0)).getTime();

  type Acc = {
    post: number; // qtyShipped where receiving has started — counts in full
    preByChannel: Map<string, number>; // pre-receipt qtyShipped per channel — capped at snapshot inbound
    linked: number;
    effMs: number;
    effDates: number[]; // counting shipments' effective dates (the ±30d windows)
    adoptionEra: boolean; // any counting shipment first seen during the initial backfill
    shipmentIds: string[];
  };
  const acc = new Map<string, Acc>();
  const of = (sku: string) => {
    let a = acc.get(sku);
    if (!a) acc.set(sku, (a = { post: 0, preByChannel: new Map(), linked: 0, effMs: 0, effDates: [], adoptionEra: false, shipmentIds: [] }));
    return a;
  };

  for (const s of counting) {
    const effMs = (s.extCreatedAt ?? s.createdAt).getTime();
    const receiptStarted =
      RECEIPT_STARTED.has(s.extStatus.toUpperCase()) || s.lines.some((l) => (l.qtyReceived ?? 0) > 0);
    const adoption = s.createdAt.getTime() <= reconcileMs + ADOPTION_WINDOW;
    for (const l of s.lines) {
      if (!l.productId || l.qtyShipped <= EPS) continue;
      const a = of(l.productId);
      if (receiptStarted) a.post += l.qtyShipped;
      else a.preByChannel.set(s.channel, (a.preByChannel.get(s.channel) ?? 0) + l.qtyShipped);
      a.effMs = Math.max(a.effMs, effMs);
      a.effDates.push(effMs);
      a.adoptionEra = a.adoptionEra || adoption;
      if (!a.shipmentIds.includes(s.id)) a.shipmentIds.push(s.id);
    }
    for (const k of s.links) {
      if (k.movement.productId) of(k.movement.productId).linked += k.qty;
    }
  }

  // Unlinked AMAZON movements grouped per SKU (for the netting pass).
  const movBySku = new Map<string, { qty: number; dateMs: number }[]>();
  for (const m of amazonMovements) {
    if (!m.productId || m.shipmentLinks.length > 0) continue;
    let list = movBySku.get(m.productId);
    if (!list) movBySku.set(m.productId, (list = []));
    list.push({ qty: m.quantity, dateMs: m.date.getTime() });
  }

  const bySku: HandoffPlan["bySku"] = new Map();
  let totalUnits = 0;
  for (const [sku, a] of acc) {
    // Pre-receipt shipments only count up to what Amazon's snapshot actually shows inbound for
    // that channel — labels printed with boxes still on the dock must not drain the pool yet.
    const snap = snapBySku.get(sku);
    let capped = a.post;
    for (const [channel, pre] of a.preByChannel) {
      const inbound = channel === "AWD" ? snap?.awdInbound ?? 0 : snap?.fbaInbound ?? 0;
      capped += Math.min(pre, inbound);
    }
    // Net against every unlinked movement that plausibly covers these shipments (see header).
    let netted = 0;
    for (const m of movBySku.get(sku) ?? []) {
      const inWindow = a.effDates.some((d) => Math.abs(d - m.dateMs) <= 30 * DAY);
      const preEra = a.adoptionEra && m.dateMs < reconcileMs;
      if (inWindow || preEra) netted += m.qty;
    }
    const qty = Math.max(0, capped - a.linked - netted);
    if (qty <= EPS) continue;
    bySku.set(sku, { qty, effMs: a.effMs, shipmentIds: a.shipmentIds });
    totalUnits += qty;
  }

  return { bySku, totalUnits, shipmentSyncStatus: conn.shipmentSyncStatus };
}

const VIRTUAL_PREFIX = "virtual:";
/** Synthetic movements are read-time artifacts — filter their shortfalls out of user-facing lists. */
export const isVirtualMovement = (id: string) => id.startsWith(VIRTUAL_PREFIX);

/**
 * The plan as engine movements — identical in both builders. Replay date is
 * max(shipment eff date, the SKU's latest supply date) so late-backfilled lots still get drained;
 * seq sits far above every real movement so same-date virtuals replay last, deterministically.
 */
export function buildVirtualMovements(plan: HandoffPlan, supply: FinishedSupply[]): FinishedMovement[] {
  if (plan.totalUnits <= EPS) return [];
  const latestSupply = new Map<string, number>();
  for (const s of supply) {
    latestSupply.set(s.sku, Math.max(latestSupply.get(s.sku) ?? 0, s.date));
  }
  return [...plan.bySku.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sku, v], i) => ({
      id: `${VIRTUAL_PREFIX}${sku}`,
      sku,
      fromFacilityId: null,
      toFacilityId: null,
      toDestination: "AMAZON",
      quantity: v.qty,
      date: Math.max(v.effMs, latestSupply.get(sku) ?? 0),
      seq: 1_000_000_000 + i,
    }));
}
