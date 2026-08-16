import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-box";
import { shopifyGraphQL } from "@/lib/shopify";

/**
 * The mapping layer between a connected channel's catalog and consl products.
 *
 * A ChannelListing row is a snapshot of one sellable thing over there (a Shopify VARIANT, an
 * Amazon seller SKU) keyed by the platform's immutable id — SKUs and titles are merely signals
 * for suggestions, never identity. The mapping itself lives on Product's per-channel columns
 * (sellerSku/asin, shopifyVariantId/…, tiktokSku/…), which is what the sync engine reads; that's
 * why disconnecting and reconnecting a channel restores the exact same picture: products keep
 * their identifiers, listings keep their ignore flags.
 */

export type ChannelKey = "SHOPIFY" | "AMAZON" | "TIKTOK";

export const CHANNEL_TITLES: Record<ChannelKey, string> = {
  SHOPIFY: "Shopify",
  AMAZON: "Amazon",
  TIKTOK: "TikTok Shop",
};

type ProductForMatch = {
  id: string;
  code: string;
  name: string;
  barcode: string | null;
  sellerSku: string | null;
  asin: string | null;
  shopifyVariantId: string | null;
  shopifySku: string | null;
  tiktokSku: string | null;
};

export const PRODUCT_MATCH_SELECT = {
  id: true,
  code: true,
  name: true,
  barcode: true,
  sellerSku: true,
  asin: true,
  shopifyVariantId: true,
  shopifySku: true,
  tiktokSku: true,
} as const;

/** The product column that anchors a mapping for each channel.
 *  TIKTOK: Product has no column for TikTok's internal SKU id, so the seller SKU *is* the listing
 *  identity (externalId = seller_sku, mirrored in tiktokSku) — same tradeoff Amazon already makes.
 *  Renaming a seller SKU on TikTok therefore orphans the mapping until it's re-linked. */
export function mappedExternalId(p: ProductForMatch, channel: ChannelKey): string | null {
  return channel === "SHOPIFY" ? p.shopifyVariantId : channel === "TIKTOK" ? p.tiktokSku : p.sellerSku;
}

export function mappingData(channel: ChannelKey, listing: { externalId: string; externalProductId: string | null; sku: string | null }) {
  return channel === "SHOPIFY"
    ? { shopifyVariantId: listing.externalId, shopifyProductId: listing.externalProductId, shopifySku: listing.sku }
    : channel === "TIKTOK"
      ? // externalId (not sku) is the anchor here — they hold the same seller SKU for TikTok, but
        // only externalId is guaranteed non-null, and it's what mappedExternalId is compared against.
        { tiktokSku: listing.externalId, tiktokProductId: listing.externalProductId }
      : { sellerSku: listing.externalId, asin: listing.externalProductId };
}

export function unmappingData(channel: ChannelKey) {
  return channel === "SHOPIFY"
    ? { shopifyVariantId: null, shopifyProductId: null, shopifySku: null }
    : channel === "TIKTOK"
      ? { tiktokSku: null, tiktokProductId: null }
      : { sellerSku: null, asin: null, fnsku: null };
}

// ---------- refresh: pull the channel's live catalog into ChannelListing rows ----------

type FetchedListing = {
  externalId: string;
  externalProductId: string | null;
  sku: string | null;
  title: string;
  imageUrl: string | null;
  price: number | null;
};

async function upsertListings(channel: ChannelKey, fetched: FetchedListing[]): Promise<{ seen: number }> {
  const existing = await prisma.channelListing.findMany({ where: { channel } });
  const byExternal = new Map(existing.map((l) => [l.externalId, l]));
  const now = new Date();

  for (const f of fetched) {
    const row = byExternal.get(f.externalId);
    if (row) {
      await prisma.channelListing.update({
        where: { id: row.id },
        // Images are decoration: keep the last known one when a refresh couldn't fetch any
        // (a throttled catalog call must not blank the screen).
        data: { sku: f.sku, title: f.title, imageUrl: f.imageUrl ?? row.imageUrl, price: f.price, externalProductId: f.externalProductId, lastSeenAt: now },
      });
    } else {
      await prisma.channelListing.create({
        data: { channel, ...f, lastSeenAt: now },
      });
    }
  }

  // A listing the platform no longer reports is gone for good (deleted or unpublished): drop the
  // worklist row. If the product was mapped to it, the mapping on the Product survives untouched.
  const seenIds = new Set(fetched.map((f) => f.externalId));
  const stale = existing.filter((l) => !seenIds.has(l.externalId)).map((l) => l.id);
  if (stale.length) await prisma.channelListing.deleteMany({ where: { id: { in: stale } } });

  return { seen: fetched.length };
}

/** Pull every active Shopify product's variants. */
export async function refreshShopifyListings(): Promise<{ seen: number }> {
  const conn = await prisma.integration.findFirst({ where: { provider: "shopify", status: "connected" } });
  if (!conn?.refreshTokenEnc || !conn.sellerId) throw new Error("Shopify is not connected");
  const token = decryptSecret(conn.refreshTokenEnc);

  const fetched: FetchedListing[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 40; page++) {
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          title: string;
          featuredMedia: { preview: { image: { url: string } | null } | null } | null;
          variants: { nodes: Array<{ id: string; title: string; sku: string | null; price: string | null }> };
        }>;
      };
    } = await shopifyGraphQL(
      conn.sellerId,
      token,
      `query($cursor: String) {
        products(first: 100, after: $cursor, query: "status:active") {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            title
            featuredMedia { preview { image { url } } }
            variants(first: 100) {
              nodes { id title sku price }
            }
          }
        }
      }`,
      { cursor },
    );
    for (const p of data.products.nodes) {
      const image = p.featuredMedia?.preview?.image?.url ?? null;
      for (const v of p.variants.nodes) {
        const variantLabel = v.title && v.title !== "Default Title" ? ` — ${v.title}` : "";
        fetched.push({
          externalId: v.id,
          externalProductId: p.id,
          sku: v.sku?.trim() || null,
          title: `${p.title}${variantLabel}`,
          imageUrl: image,
          price: v.price != null && v.price !== "" ? Number(v.price) : null,
        });
      }
    }
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  return upsertListings("SHOPIFY", fetched);
}

/** Snapshot the org's live FBA inventory as Amazon listings (seller SKU = identity). */
export async function refreshAmazonListings(): Promise<{ seen: number }> {
  const conn = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn?.refreshTokenEnc) throw new Error("Amazon is not connected");
  const { makeClient, getFbaInventory, getCatalogImages } = await import("@/lib/spapi");
  const client = makeClient({
    refreshToken: decryptSecret(conn.refreshTokenEnc),
    marketplaceId: conn.marketplaceId ?? "ATVPDKIKX0DER",
    region: conn.region ?? "na",
  });
  const rows = await getFbaInventory(client);
  // FBA inventory carries no pictures — decorate from the Catalog Items API by ASIN (batched).
  const images = await getCatalogImages(client, rows.map((r) => r.asin ?? "").filter(Boolean));
  const fetched: FetchedListing[] = rows
    .filter((r) => r.sellerSku)
    .map((r) => ({
      externalId: r.sellerSku as string,
      externalProductId: r.asin ?? null,
      sku: r.sellerSku as string,
      title: r.name?.trim() || (r.sellerSku as string),
      imageUrl: (r.asin && images.get(r.asin)) || null,
      price: null,
    }));
  return upsertListings("AMAZON", fetched);
}

type TikTokSearchProduct = {
  id: string;
  title?: string | null;
  main_images?: Array<{ urls?: string[] | null; thumb_urls?: string[] | null }> | null;
  skus?: Array<{
    id: string;
    seller_sku?: string | null;
    price?: { sale_price?: string | null; tax_exclusive_price?: string | null } | null;
  }> | null;
};

/**
 * Pull every TikTok Shop product's SKUs. One ChannelListing per SKU — identity is the SELLER SKU
 * (see mappedExternalId: Product has nowhere to hold TikTok's internal sku id), so SKUs the seller
 * left blank can't be identified and are skipped, exactly like Amazon rows without a seller SKU.
 */
export async function refreshTikTokListings(): Promise<{ seen: number }> {
  const conn = await prisma.integration.findFirst({ where: { provider: "tiktok", status: "connected" } });
  if (!conn?.refreshTokenEnc || !conn.marketplaceId) throw new Error("TikTok Shop is not connected");
  const { getTikTokAccessToken } = await import("@/lib/tiktok-oauth");
  const { tiktokApi, TIKTOK_API_VERSION, TikTokError } = await import("@/lib/tiktok");
  const token = await getTikTokAccessToken(conn);

  const fetched: FetchedListing[] = [];
  const seenIds = new Set<string>();
  let pageToken: string | null = null;
  for (let page = 0; page < 40; page++) {
    const query: Record<string, string> = {
      shop_cipher: conn.marketplaceId,
      page_size: "100",
      ...(pageToken ? { page_token: pageToken } : {}),
    };
    let data: { products?: TikTokSearchProduct[] | null; next_page_token?: string | null };
    try {
      data = await tiktokApi({ method: "POST", path: `/product/${TIKTOK_API_VERSION}/products/search`, accessToken: token, query, body: {} });
    } catch (e) {
      // Some API generations expose search as GET; fall back once rather than failing the refresh.
      if (!(e instanceof TikTokError && e.status === 404)) throw e;
      data = await tiktokApi({ method: "GET", path: `/product/${TIKTOK_API_VERSION}/products/search`, accessToken: token, query });
    }
    for (const p of data.products ?? []) {
      const title = p.title?.trim() || p.id;
      const image = p.main_images?.[0]?.thumb_urls?.[0] ?? p.main_images?.[0]?.urls?.[0] ?? null;
      const skus = p.skus ?? [];
      for (const s of skus) {
        const sellerSku = s.seller_sku?.trim();
        if (!sellerSku || seenIds.has(sellerSku)) continue; // no identity (or a duplicate) — unmappable
        seenIds.add(sellerSku);
        const rawPrice = s.price?.sale_price ?? s.price?.tax_exclusive_price;
        fetched.push({
          externalId: sellerSku,
          externalProductId: p.id,
          sku: sellerSku,
          title: skus.length > 1 ? `${title} — ${sellerSku}` : title,
          imageUrl: image,
          price: rawPrice != null && rawPrice !== "" && !Number.isNaN(Number(rawPrice)) ? Number(rawPrice) : null,
        });
      }
    }
    pageToken = data.next_page_token || null;
    if (!pageToken) break;
  }

  return upsertListings("TIKTOK", fetched);
}

export async function refreshChannelListingsCore(channel: ChannelKey): Promise<{ seen: number }> {
  return channel === "SHOPIFY" ? refreshShopifyListings() : channel === "TIKTOK" ? refreshTikTokListings() : refreshAmazonListings();
}

// ---------- suggestions: SKU first, then title similarity ----------

const normalize = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").split(/\s+/).filter((t) => t.length > 1));

function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Every SKU-ish identifier a product is known by, normalized. */
function productSkuKeys(p: ProductForMatch): Set<string> {
  const keys = [p.code, p.barcode, p.sellerSku, p.shopifySku, p.tiktokSku].map(normalize).filter(Boolean);
  return new Set(keys);
}

export type Suggestion = { productId: string; confidence: "exact" | "similar" };

/**
 * Best candidate per unmapped listing. Exact = the listing's SKU equals one of the product's
 * known identifiers, or the titles are equal after normalization. Similar = strong token overlap.
 * Products already mapped on this channel are never suggested (one listing per product per channel).
 */
export function suggestMappings(
  channel: ChannelKey,
  listings: Array<{ id: string; sku: string | null; title: string }>,
  products: ProductForMatch[],
): Map<string, Suggestion> {
  const free = products.filter((p) => !mappedExternalId(p, channel));
  const out = new Map<string, Suggestion>();
  const taken = new Set<string>();

  // Pass 1 — exact SKU / exact normalized title.
  for (const l of listings) {
    const sku = normalize(l.sku);
    const title = normalize(l.title);
    const hit = free.find(
      (p) => !taken.has(p.id) && ((sku && productSkuKeys(p).has(sku)) || (title && normalize(p.name) === title)),
    );
    if (hit) {
      out.set(l.id, { productId: hit.id, confidence: "exact" });
      taken.add(hit.id);
    }
  }

  // Pass 2 — fuzzy title overlap for the rest.
  for (const l of listings) {
    if (out.has(l.id)) continue;
    let best: { p: ProductForMatch; score: number } | null = null;
    for (const p of free) {
      if (taken.has(p.id)) continue;
      const score = titleSimilarity(l.title, p.name);
      if (score >= 0.5 && (!best || score > best.score)) best = { p, score };
    }
    if (best) {
      out.set(l.id, { productId: best.p.id, confidence: "similar" });
      taken.add(best.p.id);
    }
  }

  return out;
}

/**
 * Write the mappings that need no human judgement: exact matches only. Fuzzy candidates stay as
 * pre-selected suggestions on the screen. Returns how many products were auto-mapped.
 */
export async function autoMapExact(channel: ChannelKey): Promise<number> {
  const [listings, products] = await Promise.all([
    prisma.channelListing.findMany({ where: { channel, ignored: false } }),
    prisma.product.findMany({ select: PRODUCT_MATCH_SELECT }),
  ]);
  const mappedIds = new Set(products.map((p) => mappedExternalId(p, channel)).filter(Boolean) as string[]);
  const pending = listings.filter((l) => !mappedIds.has(l.externalId));
  const suggestions = suggestMappings(channel, pending, products);

  let mapped = 0;
  for (const l of pending) {
    const s = suggestions.get(l.id);
    if (!s || s.confidence !== "exact") continue;
    await prisma.product.update({ where: { id: s.productId }, data: mappingData(channel, l) });
    mapped++;
  }
  return mapped;
}
