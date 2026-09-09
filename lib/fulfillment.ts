import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * "Fulfilled at" as a consl facility.
 *
 * Every platform names the place an order shipped from in its own words — Shopify a location
 * name (two of Herbl's were Amazon's MCF app under two names), TikTok a warehouse id, Amazon
 * "Amazon"/"Merchant". None of those is a place consl can cost from. So each order is resolved
 * to a FACILITY: an Amazon-fulfilled order to Amazon FBA; a Shopify order to the facility that
 * mirrors its location, or to Amazon FBA when the location is Amazon's MCF app (consl skips that
 * location on purpose — FBA already is that stock); a TikTok order to the facility that mirrors
 * its warehouse, else to Amazon FBA (a seller-fulfilled TikTok order ships through MCF unless a
 * warehouse says otherwise). Unfulfilled and merchant-shipped orders resolve to nothing until
 * the operator corrects them. The platform's own label is kept next to it, untouched.
 */

type FacilityLite = { id: string; name: string; channel: string | null; externalId: string | null };

function pick(facilities: FacilityLite[]) {
  const fba = facilities.find((f) => f.channel === "AMAZON_FBA") ?? null;
  const byExternal = new Map(facilities.filter((f) => f.externalId).map((f) => [f.externalId as string, f]));
  const byName = new Map(facilities.map((f) => [f.name.trim().toLowerCase(), f]));
  return { fba, byExternal, byName };
}

type OrderLite = { id: string; channel: string; fulfillment: string | null; fulfillmentLabel: string | null; sourceData: unknown };

/** The facility one order resolves to today, or null. */
export function detectFacility(o: OrderLite, f: ReturnType<typeof pick>): string | null {
  const label = (o.fulfillmentLabel ?? "").trim();
  if (o.channel === "AMAZON") return o.fulfillment === "Amazon" ? (f.fba?.id ?? null) : null;
  if (o.channel === "SHOPIFY") {
    const sd = o.sourceData as { fulfillments?: Array<{ location?: { id?: string | null; name?: string | null } | null }> } | null;
    const loc = sd?.fulfillments?.map((x) => x.location).find((l) => l?.id || l?.name);
    const byId = loc?.id ? f.byExternal.get(loc.id) : undefined;
    if (byId) return byId.id;
    const byName = label ? f.byName.get(label.toLowerCase()) : undefined;
    if (byName) return byName.id;
    if (/amazon/i.test(label) && f.fba) return f.fba.id;
    return null;
  }
  if (o.channel === "TIKTOK") {
    const sd = o.sourceData as { warehouse_id?: string | null } | null;
    const byId = sd?.warehouse_id ? f.byExternal.get(sd.warehouse_id) : undefined;
    if (byId) return byId.id;
    return o.fulfillment === "TIKTOK" ? null : (f.fba?.id ?? null);
  }
  return null;
}

/** Resolve these orders' fulfilled-at facility from today's facilities; writes only changes. */
export async function resolveFulfillmentFacilities(orderIds: string[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  const facilities = await prisma.facility.findMany({ where: { inactive: false }, select: { id: true, name: true, channel: true, externalId: true } });
  const f = pick(facilities);
  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, channel: true, fulfillment: true, fulfillmentLabel: true, sourceData: true, fulfillmentFacilityId: true },
  });
  // One write per target facility, not per order — a history of tens of thousands stays quick.
  const byTarget = new Map<string | null, string[]>();
  for (const o of orders) {
    const next = detectFacility(o, f);
    if (next === o.fulfillmentFacilityId) continue;
    byTarget.set(next, [...(byTarget.get(next) ?? []), o.id]);
  }
  let changed = 0;
  for (const [facilityId, ids] of byTarget) {
    const r = await prisma.salesOrder.updateMany({ where: { id: { in: ids } }, data: { fulfillmentFacilityId: facilityId } });
    changed += r.count;
  }
  return changed;
}

/** Re-resolve the whole history — after a facility appears or vanishes (a location sync), or once
 *  at rollout. `onlyUnresolved` limits it to orders that still point nowhere. */
export async function resolveAllFulfillment(opts: { onlyUnresolved?: boolean } = {}): Promise<number> {
  let changed = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.salesOrder.findMany({
      where: opts.onlyUnresolved ? { fulfillmentFacilityId: null } : {},
      select: { id: true },
      orderBy: { id: "asc" },
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    changed += await resolveFulfillmentFacilities(batch.map((b) => b.id));
    cursor = batch[batch.length - 1].id;
    if (batch.length < 1000) break;
  }
  return changed;
}
