import "server-only";
import { prismaBase } from "@/lib/prisma-base";
import { prisma } from "@/lib/prisma";
import {
  type SpApiClient,
  getFbaInboundShipments,
  getFbaInboundShipmentItems,
  getAwdInboundShipments,
  type InboundShipmentHeader,
  type InboundShipmentItem,
} from "@/lib/spapi";

/**
 * The inbound-shipment mirror (single-count plan §2a/§4). Each sync upserts the org's real
 * Amazon shipments; rows are never deleted, lines are re-upserted. Failure here must NEVER fail
 * the inventory snapshot — the caller records shipmentSyncStatus and moves on.
 *
 * Liveness is STATUS-based at first sight: a shipment that is already terminal when first
 * mirrored is `historical` (inert — no virtual movements, no matching, no cards). An OPEN
 * shipment is live regardless of age — that is exactly the batch-18 shape. Amazon-internal
 * shipments (AWD→FBA replenishment, detected by origin) are marked ignored on arrival.
 */

/** Statuses that mean "this shipment never moved / will never move units". Anything else counts —
 *  INCLUDING CLOSED, forever: received units stay inside Amazon's totals, so the drain persists. */
export const TERMINAL_DEAD = new Set(["CANCELLED", "DELETED", "VOIDED", "ABANDONED", "ERROR"]);
export const isDeadStatus = (s: string) => TERMINAL_DEAD.has(s.toUpperCase());
const isTerminalAtFirstSight = (s: string) => isDeadStatus(s) || s.toUpperCase() === "CLOSED";

export async function mirrorAmazonShipments(client: SpApiClient, conn: { id: string; orgId: string | null }): Promise<void> {
  const orgId = conn.orgId!;
  const syncStart = new Date();
  const row = await prismaBase.integration.findUnique({ where: { id: conn.id } });
  const reconcileSince = row?.reconcileSince ?? syncStart;
  if (!row?.reconcileSince) {
    await prismaBase.integration.update({ where: { id: conn.id }, data: { reconcileSince: syncStart } });
  }
  // Delta window from the high-water mark (never lastSync) with a 3-day lag buffer; first run
  // looks back 18 months so the mirror covers everything the valuation layers can reference.
  const base = row?.shipmentsSyncedThrough ?? new Date(syncStart.getTime() - 548 * 86_400_000);
  const updatedAfter = new Date(base.getTime() - 3 * 86_400_000).toISOString();

  const products = await prismaBase.product.findMany({ where: { orgId }, select: { id: true, sellerSku: true } });
  const bySellerSku = new Map(products.filter((p) => p.sellerSku).map((p) => [p.sellerSku!, p.id]));

  const existing = await prismaBase.inboundShipment.findMany({ where: { orgId, platform: "amazon" } });
  const byExternal = new Map(existing.map((s) => [s.externalId, s]));

  const upsertOne = async (h: InboundShipmentHeader, items: InboundShipmentItem[] | null) => {
    const prev = byExternal.get(h.externalId);
    const data = {
      channel: h.channel,
      confirmationId: h.confirmationId,
      name: h.name,
      extStatus: h.extStatus,
      destination: h.destination,
      origin: h.origin,
      marketplaceId: client.marketplaceId,
      extCreatedAt: h.extCreatedAt ? new Date(h.extCreatedAt) : prev?.extCreatedAt ?? null,
      extUpdatedAt: h.extUpdatedAt ? new Date(h.extUpdatedAt) : null,
      lastSyncedAt: syncStart,
    };
    let shipmentId: string;
    if (prev) {
      await prismaBase.inboundShipment.update({ where: { id: prev.id }, data });
      shipmentId = prev.id;
    } else {
      const created = await prismaBase.inboundShipment.create({
        data: {
          ...data,
          orgId,
          platform: "amazon",
          externalId: h.externalId,
          // Terminal at first sight → historical (inert). Open (batch-18) → live regardless of age.
          historical: isTerminalAtFirstSight(h.extStatus),
          // Amazon-internal (replenishment) shipments never drive virtual movements.
          ignored: h.origin === "AMAZON",
        },
      });
      shipmentId = created.id;
    }
    if (items) {
      await prismaBase.inboundShipmentLine.deleteMany({ where: { shipmentId } });
      if (items.length) {
        await prismaBase.inboundShipmentLine.createMany({
          data: items.map((it) => ({
            orgId,
            shipmentId,
            sellerSku: it.sellerSku,
            productId: bySellerSku.get(it.sellerSku) ?? null,
            qtyShipped: it.qtyShipped,
            qtyReceived: it.qtyReceived,
          })),
        });
      }
    }
  };

  // FBA: headers first; per-shipment items only where they can still change (new, or previously
  // non-CLOSED) — item calls are the expensive part.
  const fba = await getFbaInboundShipments(client, updatedAfter);
  for (const h of fba) {
    const prev = byExternal.get(h.externalId);
    const needItems = !prev || !["CLOSED", ...TERMINAL_DEAD].includes(prev.extStatus.toUpperCase()) || prev.extStatus !== h.extStatus;
    const items = needItems ? await getFbaInboundShipmentItems(client, h.externalId) : null;
    await upsertOne(h, items);
  }
  // AWD: list+detail returns items inline (already serialized for the 1 rps cap).
  const awd = await getAwdInboundShipments(client, updatedAfter);
  for (const { header, items } of awd) await upsertOne(header, items);

  await autoMatch(orgId);
  await prismaBase.integration.update({
    where: { id: conn.id },
    data: { shipmentsSyncedThrough: syncStart, shipmentSyncStatus: "ok" },
  });
  void reconcileSince;
}

/**
 * Exact-match auto-linking (attribution only — the handoff layer's SKU-level netting guarantees
 * correctness even with zero links): same product, movement qty within 1% of the line's unlinked
 * remainder, movement date within ±7d of the shipment's effective date, movement unlinked,
 * shipment live. Ambiguity is left for the panel — never guessed.
 */
export async function autoMatch(orgId: string): Promise<number> {
  const [shipments, movements] = await Promise.all([
    prismaBase.inboundShipment.findMany({
      where: { orgId, platform: "amazon", historical: false, ignored: false },
      include: { lines: true, links: true },
    }),
    prismaBase.stockMovement.findMany({
      where: { orgId, itemType: "FINISHED", toDestination: "AMAZON" },
      include: { shipmentLinks: true },
    }),
  ]);
  const live = shipments.filter((s) => !isDeadStatus(s.extStatus));
  let made = 0;
  for (const mov of movements) {
    if (mov.shipmentLinks.length > 0 || !mov.productId) continue;
    const candidates = [] as { shipmentId: string; lineQty: number }[];
    for (const sh of live) {
      const eff = sh.extCreatedAt ?? sh.createdAt;
      if (Math.abs(eff.getTime() - mov.date.getTime()) > 7 * 86_400_000) continue;
      const line = sh.lines.find((l) => l.productId === mov.productId);
      if (!line) continue;
      const alreadyLinked = sh.links.filter((k) => sh.lines.some((l) => l.productId === mov.productId)).reduce((s, k) => s + k.qty, 0);
      const remainder = line.qtyShipped - alreadyLinked;
      if (remainder <= 0) continue;
      if (Math.abs(mov.quantity - remainder) / Math.max(remainder, 1) <= 0.01) candidates.push({ shipmentId: sh.id, lineQty: remainder });
    }
    if (candidates.length === 1) {
      await prismaBase.movementShipmentLink.create({
        data: { orgId, movementId: mov.id, shipmentId: candidates[0].shipmentId, qty: Math.min(mov.quantity, candidates[0].lineQty) },
      });
      made++;
    }
  }
  return made;
}

/** Panel/read query: the org's mirrored shipments with lines + linked totals (org-scoped client). */
export async function getInboundShipments() {
  const shipments = await prisma.inboundShipment.findMany({
    include: { lines: { include: { product: { select: { code: true, imageUrl: true } } } }, links: true },
    orderBy: [{ extCreatedAt: "desc" }, { createdAt: "desc" }],
  });
  return shipments.map((s) => ({
    id: s.id,
    channel: s.channel,
    externalId: s.externalId,
    name: s.name,
    extStatus: s.extStatus,
    destination: s.destination,
    origin: s.origin,
    historical: s.historical,
    ignored: s.ignored,
    dead: isDeadStatus(s.extStatus),
    effDateISO: (s.extCreatedAt ?? s.createdAt).toISOString().slice(0, 10),
    linkedQty: s.links.reduce((t, k) => t + k.qty, 0),
    lines: s.lines.map((l) => ({
      sellerSku: l.sellerSku,
      code: l.product?.code ?? null,
      imageUrl: l.product?.imageUrl ?? null,
      qtyShipped: l.qtyShipped,
      qtyReceived: l.qtyReceived,
      unmapped: !l.productId,
    })),
  }));
}
