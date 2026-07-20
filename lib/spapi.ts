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
