/**
 * Amazon Selling Partner API client (server-only).
 * LWA token refresh + FBA/AWD inventory + All-Orders sales, per connected seller.
 * App-level LWA client id/secret come from env (SPAPI_CLIENT_ID/SECRET); the seller-specific
 * refresh token + marketplace + region are passed in via makeClient(). Never logged.
 */
import { gunzipSync } from "node:zlib";

const HOSTS: Record<string, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};
/** A per-seller SP-API client: the seller's endpoint host + marketplace, plus a cached LWA access
 *  token minted from THEIR refresh token. Build one per connection (see lib/sync.ts) and pass it to
 *  the data calls below — nothing here reads a shared env token anymore. */
export type SpApiClient = {
  host: string;
  marketplaceId: string;
  accessToken: () => Promise<string>;
};

export function makeClient(creds: { refreshToken: string; marketplaceId: string; region: string }): SpApiClient {
  let cache: { value: string; exp: number } = { value: "", exp: 0 };
  return {
    host: HOSTS[creds.region] ?? HOSTS.na,
    marketplaceId: creds.marketplaceId || "ATVPDKIKX0DER",
    accessToken: async () => {
      if (cache.value && Date.now() < cache.exp - 60_000) return cache.value;
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: creds.refreshToken,
        client_id: process.env.SPAPI_CLIENT_ID ?? "",
        client_secret: process.env.SPAPI_CLIENT_SECRET ?? "",
      });
      const r = await fetch("https://api.amazon.com/auth/o2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const j = await r.json();
      if (!r.ok || !j.access_token) throw new Error(`LWA token failed: ${j.error_description || j.error || r.status}`);
      cache = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
      return cache.value;
    },
  };
}

async function sp(client: SpApiClient, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await client.accessToken();
  return fetch(client.host + path, {
    ...init,
    headers: { "x-amz-access-token": token, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

export type FbaRow = {
  sellerSku: string;
  asin: string | null;
  fnsku: string | null;
  name: string | null; // Amazon's listing title — the catalog-import bootstrap
  available: number;
  inbound: number;
  reserved: number;
  unfulfillable: number;
  total: number;
};

/** Current FBA inventory per seller SKU (fulfillable + inbound breakdown). */
export async function getFbaInventory(client: SpApiClient): Promise<FbaRow[]> {
  const out: FbaRow[] = [];
  let next = "";
  do {
    const q = new URLSearchParams({
      details: "true",
      granularityType: "Marketplace",
      granularityId: client.marketplaceId,
      marketplaceIds: client.marketplaceId,
    });
    if (next) q.set("nextToken", next);
    const r = await sp(client, `/fba/inventory/v1/summaries?${q.toString()}`);
    const j = await r.json();
    if (!r.ok) throw new Error(`FBA inventory: ${JSON.stringify(j).slice(0, 200)}`);
    for (const s of j.payload?.inventorySummaries || []) {
      const d = s.inventoryDetails || {};
      const inbound =
        (d.inboundWorkingQuantity || 0) + (d.inboundShippedQuantity || 0) + (d.inboundReceivingQuantity || 0);
      out.push({
        sellerSku: s.sellerSku,
        asin: s.asin || null,
        fnsku: s.fnSku || null,
        name: s.productName || null,
        available: d.fulfillableQuantity || 0,
        inbound,
        reserved: d.reservedQuantity?.totalReservedQuantity || 0,
        unfulfillable: d.unfulfillableQuantity?.totalUnfulfillableQuantity || 0,
        total: s.totalQuantity || 0,
      });
    }
    next = j.pagination?.nextToken || "";
  } while (next);
  return out;
}

type CatalogImageGroup = { marketplaceId?: string; images?: { variant?: string; link?: string; height?: number; width?: number }[] };

/** Largest MAIN-variant image from a catalog item's image groups (any variant as fallback). */
function pickCatalogImage(client: SpApiClient, groups: CatalogImageGroup[]): string | null {
  const group = groups.find((g) => g.marketplaceId === client.marketplaceId) ?? groups[0];
  const imgs = group?.images ?? [];
  const mains = imgs.filter((i) => (i.variant ?? "").toUpperCase() === "MAIN" && i.link);
  const pool = mains.length ? mains : imgs.filter((i) => i.link);
  if (!pool.length) return null;
  pool.sort((a, b) => (b.height ?? 0) * (b.width ?? 0) - (a.height ?? 0) * (a.width ?? 0));
  return pool[0].link ?? null;
}

/** The main product image URL for an ASIN, from the Catalog Items API. Null when unavailable —
 *  the catalog is optional decoration, never a hard failure. Picks the largest MAIN-variant image. */
export async function getCatalogImage(client: SpApiClient, asin: string): Promise<string | null> {
  const q = new URLSearchParams({ marketplaceIds: client.marketplaceId, includedData: "images" });
  const r = await sp(client, `/catalog/2022-04-01/items/${encodeURIComponent(asin)}?${q.toString()}`);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j) return null;
  // images: [{ marketplaceId, images: [{ variant, link, height, width }] }]
  return pickCatalogImage(client, j.images ?? []);
}

/** Main image per ASIN in batches of 20 (the Catalog Items search cap), throttled under the
 *  ~2 req/s limit. Decoration-only like getCatalogImage: a failed batch just yields no entries,
 *  so callers can keep whatever image they already had. */
export async function getCatalogImages(client: SpApiClient, asins: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unique = [...new Set(asins.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 20) {
    const batch = unique.slice(i, i + 20);
    if (i > 0) await new Promise((res) => setTimeout(res, 600));
    try {
      const q = new URLSearchParams({
        identifiers: batch.join(","),
        identifiersType: "ASIN",
        marketplaceIds: client.marketplaceId,
        includedData: "images",
        pageSize: "20",
      });
      const r = await sp(client, `/catalog/2022-04-01/items?${q.toString()}`);
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      for (const item of j?.items ?? []) {
        if (item?.asin) out.set(item.asin, pickCatalogImage(client, item.images ?? []));
      }
    } catch {
      // Missing pictures must never fail a listings refresh.
    }
  }
  return out;
}

export type AwdRow = { sku: string; onhand: number; inbound: number; reserved: number };

/** Amazon Warehousing & Distribution inventory per SKU (on-hand + inbound to AWD). */
export async function getAwdInventory(client: SpApiClient): Promise<AwdRow[]> {
  const out: AwdRow[] = [];
  let next = "";
  do {
    const q = new URLSearchParams({ details: "SHOW" });
    if (next) q.set("nextToken", next);
    const r = await sp(client, `/awd/2024-05-09/inventory?${q.toString()}`);
    if (r.status === 403 || r.status === 404) return out; // AWD not enabled — treat as none
    const j = await r.json();
    if (!r.ok) throw new Error(`AWD inventory: ${JSON.stringify(j).slice(0, 200)}`);
    for (const it of j.inventory || []) {
      const d = it.inventoryDetails || {};
      out.push({
        sku: it.sku,
        onhand: it.totalOnhandQuantity ?? d.availableDistributableQuantity ?? 0,
        inbound: it.totalInboundQuantity ?? d.inboundQuantity ?? 0,
        // Reserved = picked for an FBA replenishment; those units are simultaneously in FBA's
        // inbound, so the counting side subtracts them. Missing field just means 0 (safe).
        reserved: d.reservedDistributableQuantity ?? 0,
      });
    }
    next = j.nextToken || "";
  } while (next);
  return out;
}

/** Per-SKU, per-day units from the All Orders report. Amazon-fulfilled (FBA + MCF), non-cancelled.
 * Returns { sellerSku: { "YYYY-MM-DD": units } }. Chunks into ≤30-day reports (API cap) run in parallel. */
export async function getAllOrders(client: SpApiClient, startISO: string, endISO: string): Promise<Record<string, Record<string, number>>> {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const chunks: [Date, Date][] = [];
  let s = new Date(start);
  while (s < end) {
    const e = new Date(Math.min(s.getTime() + 30 * 86_400_000, end.getTime()));
    chunks.push([new Date(s), e]);
    s = e;
  }
  const iso = (d: Date) => d.toISOString().slice(0, 19) + "Z";
  const results = await Promise.all(chunks.map(([cs, ce]) => oneOrdersChunk(client, iso(cs), iso(ce))));
  const merged: Record<string, Record<string, number>> = {};
  for (const chunk of results) {
    for (const [sku, days] of Object.entries(chunk)) {
      merged[sku] ??= {};
      for (const [day, units] of Object.entries(days)) merged[sku][day] = (merged[sku][day] ?? 0) + units;
    }
  }
  return merged;
}

/** Request the All Orders report for a window, poll until ready, download and decompress the TSV.
 *  Shared by the velocity rollup (oneOrdersChunk) and the order-level importer (getAllOrderRows)
 *  so a window is only ever pulled once per caller. */
async function fetchOrdersReportTsv(client: SpApiClient, startISO: string, endISO: string): Promise<string> {
  let r = await sp(client, "/reports/2021-06-30/reports", {
    method: "POST",
    body: JSON.stringify({
      reportType: "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
      marketplaceIds: [client.marketplaceId],
      dataStartTime: startISO,
      dataEndTime: endISO,
    }),
  });
  let j = await r.json();
  if (!r.ok) throw new Error(`orders report create: ${JSON.stringify(j).slice(0, 160)}`);
  const reportId = j.reportId;
  let docId = "";
  let status = "";
  for (let i = 0; i < 60; i++) {
    await new Promise((res) => setTimeout(res, 4000));
    r = await sp(client, `/reports/2021-06-30/reports/${reportId}`);
    j = await r.json();
    status = j.processingStatus;
    if (status === "DONE") {
      docId = j.reportDocumentId;
      break;
    }
    if (status === "FATAL" || status === "CANCELLED") throw new Error(`orders report ${status}`);
  }
  if (!docId) throw new Error(`orders report timeout (${status})`);

  r = await sp(client, `/reports/2021-06-30/documents/${docId}`);
  j = await r.json();
  const dl = await fetch(j.url);
  const buf = Buffer.from(await dl.arrayBuffer());
  return j.compressionAlgorithm === "GZIP" ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

async function oneOrdersChunk(client: SpApiClient, startISO: string, endISO: string): Promise<Record<string, Record<string, number>>> {
  const text = await fetchOrdersReportTsv(client, startISO, endISO);
  const lines = text.split("\n");
  const h = lines[0].split("\t");
  const iDate = h.indexOf("purchase-date");
  const iStatus = h.indexOf("order-status");
  const iFC = h.indexOf("fulfillment-channel");
  const iSku = h.indexOf("sku");
  const iQty = h.indexOf("quantity");
  const out: Record<string, Record<string, number>> = {};
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    if (c.length <= iQty) continue;
    if (c[iStatus] === "Cancelled") continue;
    if (iFC >= 0 && c[iFC] && c[iFC] !== "Amazon") continue; // only FBA-fulfilled draws down our stock
    const sku = c[iSku];
    const day = (c[iDate] || "").slice(0, 10);
    const qty = parseInt(c[iQty], 10) || 0;
    if (!sku || !day || qty <= 0) continue;
    out[sku] ??= {};
    out[sku][day] = (out[sku][day] ?? 0) + qty;
  }
  return out;
}

export type LiveAmazonOrder = {
  orderId: string;
  purchaseDate: string;
  status: string; // Pending | Unshipped | Shipped | Canceled …
  fulfillment: string; // AFN (FBA) | MFN (merchant)
  total: number; // OrderTotal — the buyer's grand total (items + tax + shipping, net of promos)
  currency: string;
  salesChannel: string; // "Amazon.com" | "Non-Amazon" (an MCF order for another channel)
  isReplacement: boolean;
  lastUpdateDate: string;
};

export type LiveAmazonOrderItem = { sku: string; quantity: number; itemPrice: number; promotionDiscount: number; itemTax: number };

/**
 * Orders updated since `sinceISO`, from the live Orders API — the near-real-time feed. Amazon has
 * no plain-HTTPS webhooks (their push is SQS/EventBridge only), so a cursored poll of this endpoint
 * is the practical equivalent: cheap single GETs, minutes of latency, no AWS infrastructure.
 */
export async function getOrdersUpdatedSince(client: SpApiClient, sinceISO: string): Promise<LiveAmazonOrder[]> {
  const out: LiveAmazonOrder[] = [];
  let next: string | null = null;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams(
      next
        ? { NextToken: next, MarketplaceIds: client.marketplaceId }
        : { MarketplaceIds: client.marketplaceId, LastUpdatedAfter: sinceISO, MaxResultsPerPage: "100" },
    );
    const r = await sp(client, `/orders/v0/orders?${params.toString()}`);
    const j = await r.json();
    if (!r.ok) throw new Error(`orders poll: ${JSON.stringify(j).slice(0, 160)}`);
    type ApiOrder = {
      AmazonOrderId: string;
      PurchaseDate?: string;
      OrderStatus?: string;
      FulfillmentChannel?: string;
      OrderTotal?: { Amount?: string; CurrencyCode?: string };
      SalesChannel?: string;
      IsReplacementOrder?: boolean | string;
      LastUpdateDate?: string;
    };
    for (const o of (j.payload?.Orders ?? []) as ApiOrder[]) {
      out.push({
        orderId: o.AmazonOrderId,
        purchaseDate: o.PurchaseDate ?? "",
        status: o.OrderStatus ?? "",
        fulfillment: o.FulfillmentChannel ?? "",
        total: Number(o.OrderTotal?.Amount) || 0,
        currency: o.OrderTotal?.CurrencyCode ?? "USD",
        salesChannel: o.SalesChannel ?? "",
        isReplacement: o.IsReplacementOrder === true || o.IsReplacementOrder === "true",
        lastUpdateDate: o.LastUpdateDate ?? "",
      });
    }
    next = j.payload?.NextToken ?? null;
    if (!next) break;
  }
  return out;
}

/** Line items for one live order. Rate-limited hard by Amazon (0.5 rps) — the caller paces. */
export async function getOrderItems(client: SpApiClient, orderId: string): Promise<LiveAmazonOrderItem[]> {
  const r = await sp(client, `/orders/v0/orders/${orderId}/orderItems`);
  const j = await r.json();
  if (!r.ok) throw new Error(`order items: ${JSON.stringify(j).slice(0, 160)}`);
  type ApiItem = {
    SellerSKU?: string;
    QuantityOrdered?: number;
    ItemPrice?: { Amount?: string };
    PromotionDiscount?: { Amount?: string };
    ItemTax?: { Amount?: string };
  };
  return ((j.payload?.OrderItems ?? []) as ApiItem[])
    .filter((i) => i.SellerSKU)
    .map((i) => ({
      sku: i.SellerSKU!,
      quantity: i.QuantityOrdered ?? 0,
      itemPrice: Number(i.ItemPrice?.Amount) || 0,
      promotionDiscount: Math.abs(Number(i.PromotionDiscount?.Amount) || 0),
      itemTax: Number(i.ItemTax?.Amount) || 0,
    }));
}

export type AmazonOrderRow = {
  orderId: string;
  purchaseDate: string; // ISO
  status: string;
  fulfillment: string; // "Amazon" (FBA/MCF) | "Merchant"
  sku: string;
  quantity: number;
  itemPrice: number;
  promotionDiscount: number; // item-promotion-discount — subtract for net product revenue
  // Everything else the buyer was charged, so the order's "amount paid" = items + these, net of promos.
  itemTax: number;
  shippingPrice: number;
  shippingTax: number;
  shipPromotionDiscount: number;
  currency: string;
  // "Amazon.com" for marketplace sales; "Non-Amazon" = an MCF order Amazon ships for another channel.
  salesChannel: string;
  isReplacement: boolean; // is-replacement-order — a free re-ship of an earlier order
  // ---- Full-detail columns, stored so the P&L can split every dollar and dimension.
  lastUpdatedDate: string;
  itemStatus: string;
  asin: string;
  giftWrapPrice: number;
  giftWrapTax: number;
  shipServiceLevel: string;
  shipCity: string;
  shipState: string;
  shipPostalCode: string;
  shipCountry: string;
  promotionIds: string;
  isBusinessOrder: boolean;
};

/** Per-order-item rows from the All Orders report — the order-level feed for the Orders tab
 *  (versus getAllOrders, which rolls the same report up per SKU per day for velocity). Chunked
 *  ≤30 days like the rollup. Keeps every fulfillment channel; the caller decides what to show. */
export async function getAllOrderRows(client: SpApiClient, startISO: string, endISO: string): Promise<AmazonOrderRow[]> {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const chunks: [Date, Date][] = [];
  let s = new Date(start);
  while (s < end) {
    const e = new Date(Math.min(s.getTime() + 30 * 86_400_000, end.getTime()));
    chunks.push([new Date(s), e]);
    s = e;
  }
  const iso = (d: Date) => d.toISOString().slice(0, 19) + "Z";
  // Amazon rate-limits report creation hard — firing every 30-day chunk at once (a year = 12) trips
  // the quota. Run them in small parallel batches so a long backfill stays under the limit.
  const CONCURRENCY = 2;
  const texts: string[] = [];
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    texts.push(...(await Promise.all(batch.map(([cs, ce]) => fetchOrdersReportTsv(client, iso(cs), iso(ce))))));
  }
  const rows: AmazonOrderRow[] = [];
  for (const text of texts) {
    const lines = text.split("\n");
    const h = lines[0].split("\t");
    const iId = h.indexOf("amazon-order-id");
    const iDate = h.indexOf("purchase-date");
    const iStatus = h.indexOf("order-status");
    const iFC = h.indexOf("fulfillment-channel");
    const iSku = h.indexOf("sku");
    const iQty = h.indexOf("quantity");
    const iPrice = h.indexOf("item-price");
    const iPromo = h.indexOf("item-promotion-discount");
    const iItemTax = h.indexOf("item-tax");
    const iShip = h.indexOf("shipping-price");
    const iShipTax = h.indexOf("shipping-tax");
    const iShipPromo = h.indexOf("ship-promotion-discount");
    const iCur = h.indexOf("currency");
    const iSalesCh = h.indexOf("sales-channel");
    const iRepl = h.indexOf("is-replacement-order");
    const iUpdated = h.indexOf("last-updated-date");
    const iItemStatus = h.indexOf("item-status");
    const iAsin = h.indexOf("asin");
    const iGift = h.indexOf("gift-wrap-price");
    const iGiftTax = h.indexOf("gift-wrap-tax");
    const iSvc = h.indexOf("ship-service-level");
    const iCity = h.indexOf("ship-city");
    const iState = h.indexOf("ship-state");
    const iZip = h.indexOf("ship-postal-code");
    const iCountry = h.indexOf("ship-country");
    const iPromoIds = h.indexOf("promotion-ids");
    const iBiz = h.indexOf("is-business-order");
    const num = (idx: number, c: string[]) => (idx >= 0 ? Number(c[idx]) || 0 : 0);
    const str = (idx: number, c: string[]) => (idx >= 0 ? c[idx] || "" : "");
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split("\t");
      if (c.length <= iQty || iId < 0) continue;
      const orderId = c[iId];
      const sku = c[iSku];
      const qty = parseInt(c[iQty], 10) || 0;
      if (!orderId || !sku || qty <= 0) continue;
      rows.push({
        orderId,
        purchaseDate: c[iDate] || "",
        status: c[iStatus] || "",
        fulfillment: iFC >= 0 ? c[iFC] || "" : "",
        sku,
        quantity: qty,
        itemPrice: num(iPrice, c),
        promotionDiscount: Math.abs(num(iPromo, c)),
        itemTax: num(iItemTax, c),
        shippingPrice: num(iShip, c),
        shippingTax: num(iShipTax, c),
        shipPromotionDiscount: Math.abs(num(iShipPromo, c)),
        currency: iCur >= 0 ? c[iCur] || "USD" : "USD",
        salesChannel: iSalesCh >= 0 ? c[iSalesCh] || "" : "",
        isReplacement: iRepl >= 0 && (c[iRepl] || "").trim().toLowerCase() === "true",
        lastUpdatedDate: str(iUpdated, c),
        itemStatus: str(iItemStatus, c),
        asin: str(iAsin, c),
        giftWrapPrice: num(iGift, c),
        giftWrapTax: num(iGiftTax, c),
        shipServiceLevel: str(iSvc, c),
        shipCity: str(iCity, c),
        shipState: str(iState, c),
        shipPostalCode: str(iZip, c),
        shipCountry: str(iCountry, c),
        promotionIds: str(iPromoIds, c),
        isBusinessOrder: iBiz >= 0 && (c[iBiz] || "").trim().toLowerCase() === "true",
      });
    }
  }
  return rows;
}

// ── Per-seller (multi-tenant) helpers ─────────────────────────────────────────────────────────
// The functions above read one refresh token from env (the legacy single-tenant Herbl sync).
// These take a seller's own refresh token, for connections stored on `Integration`.

const LWA_URL = "https://api.amazon.com/auth/o2/token";

/** LWA access token for a SPECIFIC seller's refresh token. No global cache (tokens differ per org);
 *  Phase 3's per-org sync caches by token. */
export async function getAccessTokenFor(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.SPAPI_CLIENT_ID ?? "",
    client_secret: process.env.SPAPI_CLIENT_SECRET ?? "",
  });
  const r = await fetch(LWA_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`LWA token failed: ${j.error_description || j.error || r.status}`);
  return j.access_token;
}

export type SellerMarketplace = { id: string; name: string; countryCode: string; participating: boolean };

/** Confirm a freshly-connected token actually works, and return the seller's marketplaces (with
 *  whether they actively sell there). Called right after the OAuth callback to prove the connection
 *  end-to-end and to choose which marketplace to sync. */
export async function getMarketplaceParticipations(refreshToken: string, region = "na"): Promise<SellerMarketplace[]> {
  const token = await getAccessTokenFor(refreshToken);
  const base = HOSTS[region] ?? HOSTS.na;
  const r = await fetch(base + "/sellers/v1/marketplaceParticipations", {
    headers: { "x-amz-access-token": token, "Content-Type": "application/json" },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`marketplaceParticipations ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return (j.payload || [])
    .filter((p: { marketplace?: { id?: string } }) => !!p.marketplace?.id)
    .map((p: { marketplace: { id: string; name?: string; countryCode?: string }; participation?: { isParticipating?: boolean } }) => ({
      id: p.marketplace.id,
      name: p.marketplace.name ?? p.marketplace.id,
      countryCode: p.marketplace.countryCode ?? "",
      participating: p.participation?.isParticipating ?? false,
    }));
}

/** Pick the marketplace to sync from a participations list. Prefer a marketplace the seller actually
 *  sells in; among those, prefer Amazon US for now (the MVP focus). Sellers get a picker later. */
export function chooseMarketplace(list: SellerMarketplace[], fallback = "ATVPDKIKX0DER"): string {
  const active = list.filter((m) => m.participating);
  return active.find((m) => m.id === "ATVPDKIKX0DER")?.id ?? active[0]?.id ?? list[0]?.id ?? fallback;
}

/* ------------------------------ Finances (the money ledger) ------------------------------ */

/** One page of the Finances API's event groups, kept raw — lib/finances.ts flattens them. */
export type FinancialEventsPage = Record<string, unknown[]>;

/**
 * Every financial event posted in [postedAfter, postedBefore) — the exact ledger Amazon settles
 * money by (fees, refunds, reimbursements, ad invoices, storage…). Pages at 100 event groups per
 * call; the endpoint allows ~0.5 req/s, so pages are spaced out and 429s retried with backoff.
 */
export async function listFinancialEvents(
  client: SpApiClient,
  postedAfter: Date,
  postedBefore: Date,
): Promise<FinancialEventsPage[]> {
  const pages: FinancialEventsPage[] = [];
  let next: string | null = null;
  for (let page = 0; page < 400; page++) {
    if (page > 0) await new Promise((res) => setTimeout(res, 2100));
    const q = new URLSearchParams({ MaxResultsPerPage: "100" });
    // NextToken carries the whole query state — Amazon rejects re-sending the dates with it.
    if (next) q.set("NextToken", next);
    else {
      q.set("PostedAfter", postedAfter.toISOString());
      q.set("PostedBefore", postedBefore.toISOString());
    }
    let r: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      r = await sp(client, `/finances/v0/financialEvents?${q.toString()}`);
      if (r.status !== 429) break;
      await new Promise((res) => setTimeout(res, 5000 * (attempt + 1)));
    }
    const j = await r!.json();
    if (!r!.ok) throw new Error(`financialEvents: ${JSON.stringify(j).slice(0, 200)}`);
    const payload = j.payload ?? j;
    if (payload.FinancialEvents) pages.push(payload.FinancialEvents as FinancialEventsPage);
    next = payload.NextToken ?? null;
    if (!next) break;
  }
  return pages;
}
