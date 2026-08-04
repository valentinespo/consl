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

/** The main product image URL for an ASIN, from the Catalog Items API. Null when unavailable —
 *  the catalog is optional decoration, never a hard failure. Picks the largest MAIN-variant image. */
export async function getCatalogImage(client: SpApiClient, asin: string): Promise<string | null> {
  const q = new URLSearchParams({ marketplaceIds: client.marketplaceId, includedData: "images" });
  const r = await sp(client, `/catalog/2022-04-01/items/${encodeURIComponent(asin)}?${q.toString()}`);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j) return null;
  // images: [{ marketplaceId, images: [{ variant, link, height, width }] }]
  const groups: { marketplaceId?: string; images?: { variant?: string; link?: string; height?: number; width?: number }[] }[] =
    j.images ?? [];
  const group = groups.find((g) => g.marketplaceId === client.marketplaceId) ?? groups[0];
  const imgs = group?.images ?? [];
  const mains = imgs.filter((i) => (i.variant ?? "").toUpperCase() === "MAIN" && i.link);
  const pool = mains.length ? mains : imgs.filter((i) => i.link);
  if (!pool.length) return null;
  pool.sort((a, b) => (b.height ?? 0) * (b.width ?? 0) - (a.height ?? 0) * (a.width ?? 0));
  return pool[0].link ?? null;
}

export type AwdRow = { sku: string; onhand: number; inbound: number };

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

async function oneOrdersChunk(client: SpApiClient, startISO: string, endISO: string): Promise<Record<string, Record<string, number>>> {
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
  const text = j.compressionAlgorithm === "GZIP" ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
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
