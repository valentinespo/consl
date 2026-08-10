import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-box";
import { shopifyGraphQL } from "@/lib/shopify";

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

/** Replace the stored stock for exactly the facilities this sync covers, in one transaction. */
async function replaceStock(
  facilityIds: string[],
  rows: Array<{ facilityId: string; productId: string; units: number }>,
): Promise<void> {
  if (facilityIds.length === 0) return;
  const now = new Date();
  await prisma.$transaction([
    prisma.channelStock.deleteMany({ where: { facilityId: { in: facilityIds } } }),
    ...rows
      .filter((r) => r.units > 0)
      .map((r) => prisma.channelStock.create({ data: { ...r, syncedAt: now } })),
  ]);
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
export async function syncTikTokStock(): Promise<ChannelStockSyncResult> {
  const conn = await prisma.integration.findFirst({ where: { provider: "tiktok", status: "connected" } });
  if (!conn?.marketplaceId) return EMPTY;

  const { getTikTokAccessToken } = await import("@/lib/tiktok-oauth");
  const { tiktokApi, TIKTOK_API_VERSION } = await import("@/lib/tiktok");
  const token = await getTikTokAccessToken(conn);

  const facilities = await prisma.facility.findMany({ where: { channel: "TIKTOK", externalId: { not: null } } });
  const byWarehouse = new Map(facilities.map((f) => [f.externalId!, f.id]));
  const products = await prisma.product.findMany({ where: { tiktokSku: { not: null } }, select: { id: true, tiktokSku: true } });
  const bySku = new Map(products.map((p) => [p.tiktokSku!, p.id]));

  // facilityId → productId → units. Nested so repeated SKU/warehouse pairs across pages sum.
  const totals = new Map<string, Map<string, number>>();
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
          if (!productId || !facilityId) {
            if (units > 0) skipped++;
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

  return persist(facilities.map((f) => f.id), totals, skipped);
}

/**
 * Shopify reports stock per inventory level: one row per variant × location. Only locations we
 * mirrored as facilities are kept — which is what excludes MCF (see the module note).
 */
export async function syncShopifyStock(): Promise<ChannelStockSyncResult> {
  const conn = await prisma.integration.findFirst({ where: { provider: "shopify", status: "connected" } });
  if (!conn?.refreshTokenEnc || !conn.sellerId) return EMPTY;
  const token = decryptSecret(conn.refreshTokenEnc);

  const facilities = await prisma.facility.findMany({ where: { channel: "SHOPIFY", externalId: { not: null } } });
  const byLocation = new Map(facilities.map((f) => [f.externalId!, f.id]));
  const products = await prisma.product.findMany({
    where: { shopifyVariantId: { not: null } },
    select: { id: true, shopifyVariantId: true },
  });
  const byVariant = new Map(products.map((p) => [p.shopifyVariantId!, p.id]));

  const totals = new Map<string, Map<string, number>>();
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
        if (!productId || !facilityId) {
          if (units > 0) skipped++;
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

  return persist(facilities.map((f) => f.id), totals, skipped);
}

/** Flatten the per-facility tallies, write them, and report what landed. */
async function persist(
  facilityIds: string[],
  totals: Map<string, Map<string, number>>,
  skipped: number,
): Promise<ChannelStockSyncResult> {
  const rows: Array<{ facilityId: string; productId: string; units: number }> = [];
  for (const [facilityId, perFacility] of totals) {
    for (const [productId, units] of perFacility) rows.push({ facilityId, productId, units });
  }
  await replaceStock(facilityIds, rows);
  return {
    facilities: facilityIds.length,
    skus: rows.filter((r) => r.units > 0).length,
    units: rows.reduce((s, r) => s + r.units, 0),
    skipped,
  };
}
