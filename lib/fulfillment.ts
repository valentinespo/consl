import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-box";

/**
 * "Fulfilled at" as a consl facility — always from the platform's own record, never a guess.
 *
 * Every platform names the place an order shipped from in its own words: Shopify a location,
 * TikTok a warehouse, Amazon "Amazon"/"Merchant". Each order is resolved to a FACILITY through
 * the record of places the location/warehouse syncs keep (ChannelLocation): a place that is a
 * real facility of its own resolves to it; a place that is Amazon's MCF under any name resolves
 * to Amazon FBA (that stock already lives there); an Amazon-fulfilled order resolves to Amazon
 * FBA. A Shopify fulfillment whose location Shopify itself flags as the Amazon fulfilment service
 * resolves to FBA even when that location has since been removed from the shop.
 *
 * A place consl has never seen triggers one sync of the channel's places, then a second look.
 * Whatever still can't be identified stays UNPLACED and says so on the Orders tab, for the
 * operator to correct — it is never assumed.
 */

type Ctx = {
  fba: string | null;
  facilityByExternal: Map<string, string>; // "CHANNEL|externalId" → facility id
  places: Map<string, { facilityId: string | null; amazonMirror: boolean }>; // "CHANNEL|externalId"
  placesByName: Map<string, { facilityId: string | null; amazonMirror: boolean }>; // "CHANNEL|name"
};

async function loadContext(): Promise<Ctx> {
  const [facilities, places] = await Promise.all([
    prisma.facility.findMany({ where: { inactive: false }, select: { id: true, channel: true, externalId: true } }),
    prisma.channelLocation.findMany({ select: { channel: true, externalId: true, name: true, facilityId: true, amazonMirror: true } }),
  ]);
  const ctx: Ctx = { fba: facilities.find((f) => f.channel === "AMAZON_FBA")?.id ?? null, facilityByExternal: new Map(), places: new Map(), placesByName: new Map() };
  for (const f of facilities) if (f.externalId && f.channel) ctx.facilityByExternal.set(`${f.channel}|${f.externalId}`, f.id);
  for (const p of places) {
    ctx.places.set(`${p.channel}|${p.externalId}`, p);
    ctx.placesByName.set(`${p.channel}|${p.name.trim().toLowerCase()}`, p);
  }
  return ctx;
}

type OrderLite = { id: string; channel: string; fulfillment: string | null; fulfillmentLabel: string | null; sourceData: unknown };
type ShopifyLoc = { id?: string | null; name?: string | null; isFulfillmentService?: boolean | null; fulfillmentService?: { handle?: string | null; serviceName?: string | null } | null };

const placeFacility = (ctx: Ctx, p: { facilityId: string | null; amazonMirror: boolean } | undefined) =>
  p === undefined ? undefined : (p.facilityId ?? (p.amazonMirror ? ctx.fba : null));

/** The facility one order resolves to, null when unplaced; `unknown` names a place consl has no record of. */
export function detectFacility(o: OrderLite, ctx: Ctx): { facilityId: string | null; unknown?: string } {
  if (o.channel === "AMAZON") return { facilityId: o.fulfillment === "Amazon" ? ctx.fba : null };
  if (o.channel === "SHOPIFY") {
    const sd = o.sourceData as { fulfillments?: Array<{ location?: ShopifyLoc | null }> } | null;
    const loc = sd?.fulfillments?.map((x) => x.location).find((l) => l?.id || l?.name);
    if (!loc) return { facilityId: null };
    // Shopify's own flag: this fulfilment was done by the Amazon fulfilment service.
    const hay = `${loc.fulfillmentService?.handle ?? ""} ${loc.fulfillmentService?.serviceName ?? ""} ${loc.name ?? ""}`.toLowerCase();
    if (loc.isFulfillmentService && hay.includes("amazon")) return { facilityId: ctx.fba };
    if (loc.id) {
      const byPlace = placeFacility(ctx, ctx.places.get(`SHOPIFY|${loc.id}`));
      if (byPlace !== undefined) return { facilityId: byPlace };
      const byFacility = ctx.facilityByExternal.get(`SHOPIFY|${loc.id}`);
      if (byFacility) return { facilityId: byFacility };
      return { facilityId: null, unknown: loc.id };
    }
    const byName = placeFacility(ctx, ctx.placesByName.get(`SHOPIFY|${(loc.name ?? "").trim().toLowerCase()}`));
    return { facilityId: byName ?? null };
  }
  if (o.channel === "TIKTOK") {
    const sd = o.sourceData as { warehouse_id?: string | null } | null;
    const wid = sd?.warehouse_id;
    if (!wid) return { facilityId: null };
    const byPlace = placeFacility(ctx, ctx.places.get(`TIKTOK|${wid}`));
    if (byPlace !== undefined) return { facilityId: byPlace };
    const byFacility = ctx.facilityByExternal.get(`TIKTOK|${wid}`);
    if (byFacility) return { facilityId: byFacility };
    return { facilityId: null, unknown: wid };
  }
  return { facilityId: null };
}

/** Refresh a channel's record of places from the platform, when it is connected. */
async function refreshPlaces(channel: "SHOPIFY" | "TIKTOK"): Promise<boolean> {
  try {
    if (channel === "SHOPIFY") {
      const conn = await prisma.integration.findFirst({ where: { provider: "shopify", status: "connected" } });
      if (!conn?.refreshTokenEnc || !conn.sellerId) return false;
      const amazon = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" }, select: { id: true } });
      const { syncShopifyLocations } = await import("@/lib/shopify-locations");
      await syncShopifyLocations(conn.sellerId, decryptSecret(conn.refreshTokenEnc), { amazonConnected: !!amazon });
      return true;
    }
    const conn = await prisma.integration.findFirst({ where: { provider: "tiktok", status: "connected" } });
    if (!conn?.marketplaceId) return false;
    const { getTikTokAccessToken } = await import("@/lib/tiktok-oauth");
    const { syncTikTokWarehouses } = await import("@/lib/tiktok-locations");
    await syncTikTokWarehouses(await getTikTokAccessToken(conn), conn.marketplaceId);
    return true;
  } catch (e) {
    console.error(`[fulfillment] ${channel} places refresh failed:`, (e as Error).message);
    return false;
  }
}

/** Resolve these orders' fulfilled-at facility; writes only changes. Unknown places get one sync. */
export async function resolveFulfillmentFacilities(orderIds: string[], opts: { sync?: boolean } = { sync: true }): Promise<number> {
  if (orderIds.length === 0) return 0;
  let ctx = await loadContext();
  const orders = await prisma.salesOrder.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, channel: true, fulfillment: true, fulfillmentLabel: true, sourceData: true, fulfillmentFacilityId: true },
  });
  let results = orders.map((o) => ({ o, r: detectFacility(o, ctx) }));

  // A place consl has no record of: refresh that channel's places once, then look again.
  const unknownChannels = new Set(results.filter((x) => x.r.unknown).map((x) => x.o.channel as "SHOPIFY" | "TIKTOK"));
  if (opts.sync !== false && unknownChannels.size > 0) {
    let refreshed = false;
    for (const ch of unknownChannels) refreshed = (await refreshPlaces(ch)) || refreshed;
    if (refreshed) {
      ctx = await loadContext();
      results = orders.map((o) => ({ o, r: detectFacility(o, ctx) }));
    }
  }

  // One write per target facility, not per order — a history of tens of thousands stays quick.
  const byTarget = new Map<string | null, string[]>();
  for (const { o, r } of results) {
    if (r.facilityId === o.fulfillmentFacilityId) continue;
    byTarget.set(r.facilityId, [...(byTarget.get(r.facilityId) ?? []), o.id]);
  }
  let changed = 0;
  for (const [facilityId, ids] of byTarget) {
    const r = await prisma.salesOrder.updateMany({ where: { id: { in: ids } }, data: { fulfillmentFacilityId: facilityId } });
    changed += r.count;
  }
  return changed;
}

/** Re-resolve the whole history — after a facility appears or vanishes, or once at rollout. */
export async function resolveAllFulfillment(opts: { onlyUnresolved?: boolean } = {}): Promise<number> {
  let changed = 0;
  let cursor: string | undefined;
  let synced = false;
  for (;;) {
    const batch = await prisma.salesOrder.findMany({
      where: opts.onlyUnresolved ? { fulfillmentFacilityId: null } : {},
      select: { id: true },
      orderBy: { id: "asc" },
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    // The places refresh runs at most once per walk.
    changed += await resolveFulfillmentFacilities(batch.map((b) => b.id), { sync: !synced });
    synced = true;
    cursor = batch[batch.length - 1].id;
    if (batch.length < 1000) break;
  }
  return changed;
}
