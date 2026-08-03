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
  // SP-API throttles aggressively (some endpoints allow <1 rps). Retry 429/5xx with exponential
  // backoff instead of surfacing a transient throttle as a failed sync.
  for (let attempt = 0; ; attempt++) {
    const token = await client.accessToken();
    const r = await fetch(client.host + path, {
      ...init,
      headers: { "x-amz-access-token": token, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    if ((r.status !== 429 && r.status < 500) || attempt >= 4) return r;
    await new Promise((res) => setTimeout(res, 1200 * 2 ** attempt));
  }
}

export type FbaRow = {
  sellerSku: string;
  asin: string | null;
  fnsku: string | null;
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


// ── Inbound shipments (the single-count plan's mirror source) ────────────────────────────────
// FBA uses the legacy v0 API on purpose: it is the catch-all that lists EVERY inbound shipment
// regardless of how it was created, and the only API that reports per-SKU RECEIVED quantities.
// (v0 read operations are not deprecated; everything v0 is isolated here for easy migration.)
// AWD has its own 2024-05-09 API, rate-limited to ~1 rps — calls are strictly serialized.

export type InboundShipmentHeader = {
  channel: "FBA" | "AWD";
  externalId: string; // FBA ShipmentId / AWD shipmentId
  confirmationId: string | null;
  name: string | null;
  extStatus: string;
  destination: string | null; // FBA destination fulfillment center, when known
  origin: "SELLER" | "AMAZON"; // AMAZON = Amazon-internal (e.g. AWD→FBA replenishment)
  extCreatedAt: string | null; // ISO
  extUpdatedAt: string | null; // ISO
};

export type InboundShipmentItem = { sellerSku: string; qtyShipped: number; qtyReceived: number | null };

const AMAZON_ORIGIN_RE = /amazon|awd|fulfillment center/i;

/** FBA inbound shipments updated in a window (paged to exhaustion). */
export async function getFbaInboundShipments(
  client: SpApiClient,
  updatedAfterISO: string,
): Promise<InboundShipmentHeader[]> {
  const out: InboundShipmentHeader[] = [];
  let next = "";
  do {
    const q = new URLSearchParams(
      next
        ? { QueryType: "NEXT_TOKEN", NextToken: next, MarketplaceId: client.marketplaceId }
        : {
            QueryType: "DATE_RANGE",
            LastUpdatedAfter: updatedAfterISO,
            LastUpdatedBefore: new Date().toISOString(),
            MarketplaceId: client.marketplaceId,
            // Amazon requires an explicit status list even for date-range queries; ask for all.
            ShipmentStatusList:
              "WORKING,READY_TO_SHIP,SHIPPED,IN_TRANSIT,DELIVERED,CHECKED_IN,RECEIVING,CLOSED,CANCELLED,DELETED,ERROR",
          },
    );
    const r = await sp(client, `/fba/inbound/v0/shipments?${q.toString()}`);
    if (r.status === 403 || r.status === 404) return out; // role not granted — treat as none
    const j = await r.json();
    if (!r.ok) throw new Error(`FBA shipments: ${JSON.stringify(j).slice(0, 200)}`);
    for (const sh of j.payload?.ShipmentData ?? []) {
      const fromName = `${sh.ShipFromAddress?.Name ?? ""} ${sh.ShipFromAddress?.AddressLine1 ?? ""}`;
      out.push({
        channel: "FBA",
        externalId: sh.ShipmentId,
        confirmationId: sh.ShipmentId ?? null,
        name: sh.ShipmentName ?? null,
        extStatus: sh.ShipmentStatus ?? "UNKNOWN",
        destination: sh.DestinationFulfillmentCenterId ?? null,
        origin: AMAZON_ORIGIN_RE.test(fromName) ? "AMAZON" : "SELLER",
        extCreatedAt: null, // v0 has no created timestamp; the mirror falls back to first-seen
        extUpdatedAt: null,
      });
    }
    next = j.payload?.NextToken ?? "";
  } while (next);
  return out;
}

/** Per-SKU shipped + received quantities for one FBA shipment (paged). */
export async function getFbaInboundShipmentItems(client: SpApiClient, shipmentId: string): Promise<InboundShipmentItem[]> {
  const out: InboundShipmentItem[] = [];
  let next = "";
  do {
    const q = new URLSearchParams(
      next ? { QueryType: "NEXT_TOKEN", NextToken: next, MarketplaceId: client.marketplaceId } : { MarketplaceId: client.marketplaceId },
    );
    const path = next
      ? `/fba/inbound/v0/shipmentItems?${q.toString()}`
      : `/fba/inbound/v0/shipments/${encodeURIComponent(shipmentId)}/items?${q.toString()}`;
    const r = await sp(client, path);
    const j = await r.json();
    if (!r.ok) throw new Error(`FBA shipment items ${shipmentId}: ${JSON.stringify(j).slice(0, 200)}`);
    for (const it of j.payload?.ItemData ?? []) {
      out.push({
        sellerSku: it.SellerSKU,
        qtyShipped: it.QuantityShipped ?? 0,
        qtyReceived: it.QuantityReceived ?? null,
      });
    }
    next = j.payload?.NextToken ?? "";
  } while (next);
  return out;
}

const awdPause = () => new Promise((r) => setTimeout(r, 1100)); // ≤1 rps, burst 1

/** AWD inbound shipments (list is summaries; detail adds per-SKU quantities). Serialized. */
export async function getAwdInboundShipments(
  client: SpApiClient,
  updatedAfterISO: string,
): Promise<{ header: InboundShipmentHeader; items: InboundShipmentItem[] }[]> {
  const out: { header: InboundShipmentHeader; items: InboundShipmentItem[] }[] = [];
  let next = "";
  do {
    const q = new URLSearchParams({ updatedAfter: updatedAfterISO });
    if (next) q.set("nextToken", next);
    const r = await sp(client, `/awd/2024-05-09/inboundShipments?${q.toString()}`);
    if (r.status === 403 || r.status === 404) return out; // AWD not enabled
    const j = await r.json();
    if (!r.ok) throw new Error(`AWD shipments: ${JSON.stringify(j).slice(0, 200)}`);
    for (const sh of j.shipments ?? []) {
      await awdPause();
      const dr = await sp(client, `/awd/2024-05-09/inboundShipments/${encodeURIComponent(sh.shipmentId)}?skuQuantities=SHOW`);
      const dj = await dr.json();
      if (!dr.ok) throw new Error(`AWD shipment ${sh.shipmentId}: ${JSON.stringify(dj).slice(0, 200)}`);
      const items: InboundShipmentItem[] = [];
      // Field shape has varied across doc revisions — read both spellings defensively.
      for (const sq of dj.shipmentSkuQuantities ?? dj.skuQuantities ?? []) {
        items.push({
          sellerSku: sq.sku ?? sq.sellerSku,
          qtyShipped: sq.expectedQuantity?.quantity ?? sq.expectedQuantity ?? 0,
          qtyReceived: sq.receivedQuantity?.quantity ?? sq.receivedQuantity ?? null,
        });
      }
      out.push({
        header: {
          channel: "AWD",
          externalId: sh.shipmentId,
          confirmationId: dj.externalReferenceId ?? sh.externalReferenceId ?? null,
          name: dj.shipmentName ?? sh.shipmentName ?? null,
          extStatus: dj.shipmentStatus ?? sh.shipmentStatus ?? "UNKNOWN",
          destination: null,
          origin: "SELLER", // AWD inbound is always seller→Amazon; replenishment OUT of AWD shows on the FBA side
          extCreatedAt: dj.createdAt ?? sh.createdAt ?? null,
          extUpdatedAt: dj.updatedAt ?? sh.updatedAt ?? null,
        },
        items,
      });
    }
    next = j.nextToken ?? "";
    if (next) await awdPause();
  } while (next);
  return out;
}
