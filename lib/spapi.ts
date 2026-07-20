/**
 * Amazon Selling Partner API client (server-only).
 * LWA token refresh + FBA inventory (getInventorySummaries) + Sales & Traffic report.
 * Credentials come from env: SPAPI_CLIENT_ID / SPAPI_CLIENT_SECRET / SPAPI_REFRESH_TOKEN /
 * SPAPI_MARKETPLACE_ID / SPAPI_REGION. Never logged.
 */
import { gunzipSync } from "node:zlib";

const HOSTS: Record<string, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};
const host = () => HOSTS[process.env.SPAPI_REGION ?? "na"] ?? HOSTS.na;
const marketplace = () => process.env.SPAPI_MARKETPLACE_ID || "ATVPDKIKX0DER";

let cached: { value: string; exp: number } = { value: "", exp: 0 };

export async function getAccessToken(): Promise<string> {
  if (cached.value && Date.now() < cached.exp - 60_000) return cached.value;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: process.env.SPAPI_REFRESH_TOKEN ?? "",
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
  cached = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.value;
}

async function sp(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return fetch(host() + path, {
    ...init,
    headers: { "x-amz-access-token": token, "Content-Type": "application/json", ...(init.headers || {}) },
  });
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
export async function getFbaInventory(): Promise<FbaRow[]> {
  const out: FbaRow[] = [];
  let next = "";
  do {
    const q = new URLSearchParams({
      details: "true",
      granularityType: "Marketplace",
      granularityId: marketplace(),
      marketplaceIds: marketplace(),
    });
    if (next) q.set("nextToken", next);
    const r = await sp(`/fba/inventory/v1/summaries?${q.toString()}`);
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
export async function getAwdInventory(): Promise<AwdRow[]> {
  const out: AwdRow[] = [];
  let next = "";
  do {
    const q = new URLSearchParams({ details: "SHOW" });
    if (next) q.set("nextToken", next);
    const r = await sp(`/awd/2024-05-09/inventory?${q.toString()}`);
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
export async function getAllOrders(startISO: string, endISO: string): Promise<Record<string, Record<string, number>>> {
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
  const results = await Promise.all(chunks.map(([cs, ce]) => oneOrdersChunk(iso(cs), iso(ce))));
  const merged: Record<string, Record<string, number>> = {};
  for (const chunk of results) {
    for (const [sku, days] of Object.entries(chunk)) {
      merged[sku] ??= {};
      for (const [day, units] of Object.entries(days)) merged[sku][day] = (merged[sku][day] ?? 0) + units;
    }
  }
  return merged;
}

async function oneOrdersChunk(startISO: string, endISO: string): Promise<Record<string, Record<string, number>>> {
  let r = await sp("/reports/2021-06-30/reports", {
    method: "POST",
    body: JSON.stringify({
      reportType: "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
      marketplaceIds: [marketplace()],
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
    r = await sp(`/reports/2021-06-30/reports/${reportId}`);
    j = await r.json();
    status = j.processingStatus;
    if (status === "DONE") {
      docId = j.reportDocumentId;
      break;
    }
    if (status === "FATAL" || status === "CANCELLED") throw new Error(`orders report ${status}`);
  }
  if (!docId) throw new Error(`orders report timeout (${status})`);

  r = await sp(`/reports/2021-06-30/documents/${docId}`);
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

/** Units ordered per child ASIN over [startISO, endISO] via the Sales & Traffic report (async). */
export async function getSalesUnits(startISO: string, endISO: string): Promise<Record<string, number>> {
  let r = await sp("/reports/2021-06-30/reports", {
    method: "POST",
    body: JSON.stringify({
      reportType: "GET_SALES_AND_TRAFFIC_REPORT",
      marketplaceIds: [marketplace()],
      dataStartTime: startISO,
      dataEndTime: endISO,
      reportOptions: { dateGranularity: "DAY", asinGranularity: "CHILD" },
    }),
  });
  let j = await r.json();
  if (!r.ok) throw new Error(`report create: ${JSON.stringify(j).slice(0, 200)}`);
  const reportId = j.reportId;

  let docId = "";
  let status = "";
  for (let i = 0; i < 45; i++) {
    await new Promise((res) => setTimeout(res, 4000));
    r = await sp(`/reports/2021-06-30/reports/${reportId}`);
    j = await r.json();
    status = j.processingStatus;
    if (status === "DONE") {
      docId = j.reportDocumentId;
      break;
    }
    if (status === "FATAL" || status === "CANCELLED") throw new Error(`report ${status}`);
  }
  if (!docId) throw new Error(`report timeout (${status})`);

  r = await sp(`/reports/2021-06-30/documents/${docId}`);
  j = await r.json();
  const dl = await fetch(j.url);
  const buf = Buffer.from(await dl.arrayBuffer());
  const text = j.compressionAlgorithm === "GZIP" ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  const data = JSON.parse(text);
  const map: Record<string, number> = {};
  for (const a of data.salesAndTrafficByAsin || []) {
    const asin = a.childAsin || a.parentAsin;
    const units = a.salesByAsin?.unitsOrdered || 0;
    if (asin) map[asin] = (map[asin] || 0) + units;
  }
  return map;
}
