import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-box";
import { shopifyGraphQL } from "@/lib/shopify";
import { refreshChannelPlaces } from "@/lib/fulfillment";

/**
 * Pull the stock a sales channel says it is holding and file it against the facility that actually
 * holds it — Shopify location → its facility, TikTok warehouse → its facility.
 *
 * Amazon is deliberately not here: it reports a richer FBA/AWD breakdown that the reorder engine
 * reads off SkuSnapshot (see lib/sync.ts). This module covers the channels that report one plain
 * quantity per warehouse.
 *
 * Two rules make the numbers trustworthy:
 *  1. A quantity is only stored when BOTH ends resolve — the warehouse maps to a facility we
 *     mirrored, and the listing maps to a consl product. Anything else is counted as "skipped"
 *     rather than guessed at, because inventing a location or a SKU is worse than showing nothing.
 *  2. Shopify's "Amazon Fulfillment" (MCF) location has no facility on purpose, so rule 1 drops it.
 *     Those units are the SAME physical Amazon stock already counted under FBA — importing them
 *     would double-count every unit. See [[shopify-integration]].
 *
 * The channel is the source of truth for its own stock, so a sync REPLACES every row for the
 * facilities it covers. A SKU that drops to zero (or stops being reported) therefore disappears
 * instead of lingering at its last known count.
 */

export type ChannelStockSyncResult = {
  facilities: number; // channel facilities the sync wrote
  skus: number; // SKU × facility rows stored
  units: number; // total units stored
  skipped: number; // quantities dropped because the warehouse or the SKU didn't resolve
};

const EMPTY: ChannelStockSyncResult = { facilities: 0, skus: 0, units: 0, skipped: 0 };

/** Replace one platform's stored stock for exactly the facilities this sync covers, in one
 *  transaction. Another platform's rows on the same facility (a merged warehouse) are untouched. */
async function replaceStock(
  channel: "SHOPIFY" | "TIKTOK",
  facilityIds: string[],
  rows: Array<{ facilityId: string; productId: string; units: number }>,
): Promise<void> {
  if (facilityIds.length === 0) return;
  const now = new Date();
  await prisma.$transaction([
    prisma.channelStock.deleteMany({ where: { facilityId: { in: facilityIds }, OR: [{ channel }, { channel: null }] } }),
    ...rows
      .filter((r) => r.units > 0)
      .map((r) => prisma.channelStock.create({ data: { ...r, channel, syncedAt: now } })),
  ]);
}

/** The facility each of a platform's places counts at: the place record first (a person may have
 *  pointed it at another facility, or said it counts nowhere), else the facility the platform's
 *  sync created for it. */
async function placeFacilities(channel: "SHOPIFY" | "TIKTOK"): Promise<Map<string, string>> {
  const [places, facilities] = await Promise.all([
    prisma.channelLocation.findMany({ where: { channel }, select: { externalId: true, facilityId: true, mode: true } }),
    prisma.facility.findMany({ where: { channel, externalId: { not: null }, inactive: false }, select: { externalId: true, id: true } }),
  ]);
  const m = new Map(facilities.map((f) => [f.externalId!, f.id]));
  for (const p of places) {
    if (p.mode === "ignored" || p.mode === "mcf") m.delete(p.externalId); // counted nowhere — MCF units are FBA's
    else if (p.facilityId) m.set(p.externalId, p.facilityId);
  }
  return m;
}

/** What each place reported for the company's products, kept on the place itself — so Map
 *  facilities can say what an ignored or MCF place holds that is not counted. */
async function recordReported(channel: "SHOPIFY" | "TIKTOK", reported: Map<string, Map<string, number>>): Promise<void> {
  const rows = await prisma.channelLocation.findMany({ where: { channel }, select: { id: true, externalId: true } });
  const now = new Date();
  for (const r of rows) {
    const per = reported.get(r.externalId);
    const units = per ? [...per.values()].reduce((t, u) => t + u, 0) : 0;
    const skus = per ? [...per.values()].filter((u) => u > 0).length : 0;
    await prisma.channelLocation.update({ where: { id: r.id }, data: { reportedUnits: units, reportedSkus: skus, reportedAt: now } });
  }
}

export type ChannelStockCell = {
  facilityId: string;
  productId: string;
  units: number;
  channel: string; // the facility's own platform (SHOPIFY | TIKTOK) — the pool its units are valued from
  source: string; // the platform whose report these units come from
};
export type FacilityStockSource = { facilityId: string; platforms: string[]; source: string | null };

/** Which platform's report counts for a facility: the choice made on it (while that platform
 *  still reports there), else its own platform, else the first platform pointed at it. */
export function stockSourceOf(f: { channel: string | null; stockSource: string | null }, platforms: string[]): string | null {
  if (f.stockSource && platforms.includes(f.stockSource)) return f.stockSource;
  if (f.channel === "SHOPIFY" || f.channel === "TIKTOK") return f.channel;
  return platforms[0] ?? null;
}

/** Per active facility: the platforms that report its stock (its own, plus every place a person
 *  merged into it) and the one that counts. */
export async function facilityStockSources(): Promise<Map<string, FacilityStockSource>> {
  const [facilities, places] = await Promise.all([
    prisma.facility.findMany({ where: { inactive: false }, select: { id: true, channel: true, stockSource: true } }),
    prisma.channelLocation.findMany({ where: { facilityId: { not: null }, mode: "merged", channel: { in: ["SHOPIFY", "TIKTOK"] } }, select: { facilityId: true, channel: true } }),
  ]);
  const out = new Map<string, FacilityStockSource>();
  for (const f of facilities) {
    const platforms = f.channel === "SHOPIFY" || f.channel === "TIKTOK" ? [f.channel] : [];
    for (const p of places) if (p.facilityId === f.id && !platforms.includes(p.channel)) platforms.push(p.channel);
    out.set(f.id, { facilityId: f.id, platforms, source: stockSourceOf(f, platforms) });
  }
  return out;
}

/** The stock the platforms report at the company's CHANNEL facilities — ONE platform per facility
 *  (its stock source), so a warehouse two platforms report is never counted twice. A facility the
 *  company keeps its own books for (lots and movements) has no cell here: those books count. */
export async function readChannelStock(): Promise<{ cells: ChannelStockCell[] }> {
  const [rows, sources] = await Promise.all([
    prisma.channelStock.findMany({
      where: { units: { gt: 0 } },
      select: { productId: true, facilityId: true, units: true, channel: true, facility: { select: { channel: true, inactive: true } } },
      orderBy: [{ facilityId: "asc" }, { productId: "asc" }],
    }),
    facilityStockSources(),
  ]);
  const cells: ChannelStockCell[] = [];
  for (const r of rows) {
    const fc = r.facility.channel;
    if ((fc !== "SHOPIFY" && fc !== "TIKTOK") || r.facility.inactive) continue;
    const reported = r.channel ?? fc;
    const src = sources.get(r.facilityId)?.source ?? fc;
    if (reported === src) cells.push({ facilityId: r.facilityId, productId: r.productId, units: r.units, channel: fc, source: src });
  }
  return { cells };
}

type TikTokStockProduct = {
  id: string;
  skus?: Array<{
    seller_sku?: string | null;
    inventory?: Array<{ quantity?: number | null; warehouse_id?: string | null }> | null;
  }> | null;
};

/**
 * TikTok reports stock inline on the product search response — the same call the mapping screen
 * already makes — as `skus[].inventory[] = { quantity, warehouse_id }`. No extra request needed.
 */
export async function syncTikTokStock(opts: { retried?: boolean } = {}): Promise<ChannelStockSyncResult> {
  const conn = await prisma.integration.findFirst({ where: { provider: "tiktok", status: "connected" } });
  if (!conn?.marketplaceId) return EMPTY;

  const { getTikTokAccessToken } = await import("@/lib/tiktok-oauth");
  const { tiktokApi, TIKTOK_API_VERSION } = await import("@/lib/tiktok");
  const token = await getTikTokAccessToken(conn);

  const byWarehouse = await placeFacilities("TIKTOK");
  const facilityIds = [...new Set(byWarehouse.values())];
  // Every warehouse consl has on record, facility or not (Amazon's MCF one, a return warehouse).
  // Stock in a warehouse on NO record means a new place: re-read the shop's warehouses once and go
  // again, so it counts from its first pass instead of being skipped until an order names it.
  const known = new Set((await prisma.channelLocation.findMany({ where: { channel: "TIKTOK" }, select: { externalId: true } })).map((l) => l.externalId));
  const unknown = new Set<string>();
  const products = await prisma.product.findMany({ where: { tiktokSku: { not: null } }, select: { id: true, tiktokSku: true } });
  const bySku = new Map(products.map((p) => [p.tiktokSku!, p.id]));

  // facilityId → productId → units. Nested so repeated SKU/warehouse pairs across pages sum.
  const totals = new Map<string, Map<string, number>>();
  const reported = new Map<string, Map<string, number>>(); // warehouse → product → units, facility or not
  let skipped = 0;
  let pageToken: string | null = null;

  for (let page = 0; page < 40; page++) {
    const query: Record<string, string> = {
      shop_cipher: conn.marketplaceId,
      page_size: "100",
      ...(pageToken ? { page_token: pageToken } : {}),
    };
    const data = await tiktokApi<{ products?: TikTokStockProduct[] | null; next_page_token?: string | null }>({
      method: "POST",
      path: `/product/${TIKTOK_API_VERSION}/products/search`,
      accessToken: token,
      query,
      body: {},
    });

    for (const p of data.products ?? []) {
      for (const s of p.skus ?? []) {
        const productId = s.seller_sku ? bySku.get(s.seller_sku.trim()) : undefined;
        for (const inv of s.inventory ?? []) {
          const units = Math.max(0, Math.round(inv.quantity ?? 0));
          const facilityId = inv.warehouse_id ? byWarehouse.get(inv.warehouse_id) : undefined;
          if (productId && inv.warehouse_id && units > 0) {
            const per = reported.get(inv.warehouse_id) ?? new Map<string, number>();
            per.set(productId, (per.get(productId) ?? 0) + units);
            reported.set(inv.warehouse_id, per);
          }
          if (!productId || !facilityId) {
            if (units > 0) skipped++;
            if (units > 0 && inv.warehouse_id && !facilityId && !known.has(inv.warehouse_id)) unknown.add(inv.warehouse_id);
            continue;
          }
          const perFacility = totals.get(facilityId) ?? new Map<string, number>();
          perFacility.set(productId, (perFacility.get(productId) ?? 0) + units);
          totals.set(facilityId, perFacility);
        }
      }
    }
    pageToken = data.next_page_token || null;
    if (!pageToken) break;
  }

  if (unknown.size > 0 && !opts.retried && (await refreshChannelPlaces("TIKTOK"))) return syncTikTokStock({ retried: true });
  return persist("TIKTOK", facilityIds, totals, skipped, reported);
}

/**
 * Shopify reports stock per inventory level: one row per variant × location. Only locations we
 * mirrored as facilities are kept — which is what excludes MCF (see the module note).
 */
export async function syncShopifyStock(opts: { retried?: boolean } = {}): Promise<ChannelStockSyncResult> {
  const conn = await prisma.integration.findFirst({ where: { provider: "shopify", status: "connected" } });
  if (!conn?.refreshTokenEnc || !conn.sellerId) return EMPTY;
  const token = decryptSecret(conn.refreshTokenEnc);

  const byLocation = await placeFacilities("SHOPIFY");
  const facilityIds = [...new Set(byLocation.values())];
  // Every location consl has on record, facility or not (the MCF mirror, a deactivated one). Stock
  // at a location on NO record means a new place: re-read the shop's locations once and go again,
  // so it counts from its first pass instead of being skipped until an order names it.
  const known = new Set((await prisma.channelLocation.findMany({ where: { channel: "SHOPIFY" }, select: { externalId: true } })).map((l) => l.externalId));
  const unknown = new Set<string>();
  const products = await prisma.product.findMany({
    where: { shopifyVariantId: { not: null } },
    select: { id: true, shopifyVariantId: true },
  });
  const byVariant = new Map(products.map((p) => [p.shopifyVariantId!, p.id]));

  const totals = new Map<string, Map<string, number>>();
  const reported = new Map<string, Map<string, number>>(); // location → product → units, facility or not
  let skipped = 0;
  let cursor: string | null = null;

  for (let page = 0; page < 40; page++) {
    const data: {
      productVariants: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          inventoryItem: {
            inventoryLevels: {
              nodes: Array<{ location: { id: string }; quantities: Array<{ quantity: number }> }>;
            };
          } | null;
        }>;
      };
    } = await shopifyGraphQL(
      conn.sellerId,
      token,
      `query($cursor: String) {
        productVariants(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            inventoryItem {
              inventoryLevels(first: 20) {
                nodes { location { id } quantities(names: ["available"]) { quantity } }
              }
            }
          }
        }
      }`,
      { cursor },
    );

    for (const v of data.productVariants.nodes) {
      const productId = byVariant.get(v.id);
      for (const lvl of v.inventoryItem?.inventoryLevels.nodes ?? []) {
        const units = Math.max(0, Math.round(lvl.quantities?.[0]?.quantity ?? 0));
        const facilityId = byLocation.get(lvl.location.id);
        if (productId && units > 0) {
          const per = reported.get(lvl.location.id) ?? new Map<string, number>();
          per.set(productId, (per.get(productId) ?? 0) + units);
          reported.set(lvl.location.id, per);
        }
        if (!productId || !facilityId) {
          if (units > 0) skipped++;
          if (units > 0 && !facilityId && !known.has(lvl.location.id)) unknown.add(lvl.location.id);
          continue;
        }
        const perFacility = totals.get(facilityId) ?? new Map<string, number>();
        perFacility.set(productId, (perFacility.get(productId) ?? 0) + units);
        totals.set(facilityId, perFacility);
      }
    }
    if (!data.productVariants.pageInfo.hasNextPage) break;
    cursor = data.productVariants.pageInfo.endCursor;
  }

  if (unknown.size > 0 && !opts.retried && (await refreshChannelPlaces("SHOPIFY"))) return syncShopifyStock({ retried: true });
  return persist("SHOPIFY", facilityIds, totals, skipped, reported);
}

/** Flatten the per-facility tallies, write them, and report what landed. */
async function persist(
  channel: "SHOPIFY" | "TIKTOK",
  facilityIds: string[],
  totals: Map<string, Map<string, number>>,
  skipped: number,
  reported: Map<string, Map<string, number>>,
): Promise<ChannelStockSyncResult> {
  const rows: Array<{ facilityId: string; productId: string; units: number }> = [];
  for (const [facilityId, perFacility] of totals) {
    for (const [productId, units] of perFacility) rows.push({ facilityId, productId, units });
  }
  await replaceStock(channel, facilityIds, rows);
  await recordReported(channel, reported);
  return {
    facilities: facilityIds.length,
    skus: rows.filter((r) => r.units > 0).length,
    units: rows.reduce((s, r) => s + r.units, 0),
    skipped,
  };
}
