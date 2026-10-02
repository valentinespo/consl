import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { getOrgSettings, saveOrgSettings } from "@/lib/settings";
import { decryptSecret } from "@/lib/secret-box";
import { fetchReportText, makeClient } from "@/lib/spapi";

/**
 * Units that leave Amazon's stock without a sale, or come back into it — from Amazon's own
 * reports, stored as StockEvent rows the P&L prices at first-in-first-out cost inside Cost of
 * goods (removal orders, lost & destroyed, found & returned). Sales are costed by their orders;
 * this is everything else:
 *
 * - The FBA inventory LEDGER (every unit movement, per SKU, per day): removal orders shipped out
 *   (VendorReturns), customer returns received back (any condition), and the adjustments that
 *   change how many units there are — destroyed (D), lost/misplaced (M, 5), found (F), taken out
 *   because Amazon reimbursed them or received them by mistake (O), added back (N: found for you,
 *   or units a reimbursement gave back). Damage and condition changes (E, 6, 7, H, K, U, Q, P)
 *   move units between conditions inside Amazon's stock and always pair up, so they're skipped;
 *   so are receipts, customer shipments and transfers between Amazon's warehouses.
 * - The REIMBURSEMENTS report, for the losses the ledger can't show: units lost on the way in (never
 *   received), and anything lost in AWD — the ledger is FBA's alone, AWD stock never appears in it
 *   (checked on Herbl: July 2026's 1,800 LDX units into AWD are nowhere in it, nor is any AWD
 *   warehouse). A lost-inbound reimbursement for FBA counts its units paid in cash or given back
 *   as stock (stock given back comes in again through the ledger's N); an AWD one counts the units
 *   paid in cash only (stock given back stays in AWD: nothing was lost). A reversal counts them
 *   back. Every other reimbursement is money only: its units are already in the ledger.
 *
 * Amazon keeps 18 months of both. The first read takes all of it; later reads replace the last 45
 * days (a day's rows can still change), so a pause of any length within that is closed on its own.
 */

const LEDGER = "GET_LEDGER_DETAIL_VIEW_DATA";
const REIMBURSEMENTS = "GET_FBA_REIMBURSEMENTS_DATA";
const HISTORY_DAYS = 540;
const REFRESH_DAYS = 45;
const DAY = 86_400_000;

const ADJUSTMENT_KIND: Record<string, string> = { D: "DESTROYED", M: "LOST", "5": "LOST", F: "FOUND", O: "REIMBURSED", N: "CREDITED" };
const LOST_INBOUND = new Set(["Lost_Inbound", "AWD_Lost_Inbound"]);
// Any AWD reason: its units are in no ledger. On the way in it is LOST_INBOUND, inside AWD LOST_AWD.
const isAwd = (reason: string | undefined) => /^AWD/i.test(reason ?? "");

type EventRow = { channel: string; source: string; kind: string; at: Date; sku: string; quantity: number; detail: string | null; reference: string | null };

/** A tab-separated report as one object per row, keyed by its header. The ledger quotes every
 *  field ("Date"), the reimbursements report doesn't; both read the same. */
function rowsOf(text: string): Record<string, string>[] {
  const cell = (v: string | undefined) => {
    const t = (v ?? "").trim();
    return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t;
  };
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split("\t").map(cell);
  return lines.slice(1).map((l) => {
    const cells = l.split("\t");
    return Object.fromEntries(head.map((h, i) => [h, cell(cells[i])]));
  });
}

/** The ledger stamps a whole day at Amazon's midnight (Pacific); noon of that day keeps the event
 *  on its calendar day on almost any company clock. */
function ledgerInstant(r: Record<string, string>): Date | null {
  const stamped = Date.parse(r["Date and Time"] ?? "");
  if (Number.isFinite(stamped)) return new Date(stamped + 12 * 3_600_000);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(r["Date"] ?? "");
  return m ? new Date(`${m[3]}-${m[1]}-${m[2]}T19:00:00Z`) : null;
}

export function ledgerEvents(text: string): EventRow[] {
  const out: EventRow[] = [];
  for (const r of rowsOf(text)) {
    const quantity = Math.trunc(Number(r["Quantity"]));
    const sku = r["MSKU"];
    const at = ledgerInstant(r);
    if (!quantity || !sku || !at) continue;
    const type = r["Event Type"];
    const kind = type === "VendorReturns" ? "REMOVAL" : type === "CustomerReturns" ? "RETURNED" : type === "Adjustments" ? ADJUSTMENT_KIND[r["Reason"]] : undefined;
    if (!kind) continue;
    const detail = [r["Disposition"], r["Reason"]].filter(Boolean).join(" · ") || null;
    out.push({ channel: "AMAZON", source: "ledger", kind, at, sku, quantity, detail, reference: r["Fulfillment Center"] || null });
  }
  return out;
}

export function reimbursementEvents(text: string): EventRow[] {
  const out: EventRow[] = [];
  for (const r of rowsOf(text)) {
    const reason = r["reason"];
    const reversal = reason === "Reimbursement_Reversal";
    const type = reversal ? r["original-reimbursement-type"] : reason;
    const awd = isAwd(type);
    if (!LOST_INBOUND.has(type) && !awd) continue;
    // A reimbursement for lost units: they left. A reversal (the cash taken back): they came back.
    const cash = Math.trunc(Number(r["quantity-reimbursed-cash"] || 0));
    const units = awd ? cash : cash + Math.trunc(Number(r["quantity-reimbursed-inventory"] || 0));
    const at = new Date(r["approval-date"]);
    if (!units || !r["sku"] || Number.isNaN(at.getTime())) continue;
    out.push({
      channel: "AMAZON",
      source: "reimbursement",
      kind: LOST_INBOUND.has(type) ? "LOST_INBOUND" : "LOST_AWD",
      at,
      sku: r["sku"],
      quantity: -units,
      detail: reversal ? `Reversal of ${r["original-reimbursement-type"]}` : reason,
      reference: r["reimbursement-id"] || null,
    });
  }
  return out;
}

/** Replace one source's rows in [from, to) with what the report says now. */
async function replace(orgId: string, source: string, from: Date, to: Date, rows: EventRow[]): Promise<void> {
  await prisma.$transaction([
    prisma.stockEvent.deleteMany({ where: { channel: "AMAZON", source, at: { gte: from, lt: to } } }),
    ...Array.from({ length: Math.ceil(rows.length / 1000) }, (_, i) =>
      prisma.stockEvent.createMany({ data: rows.slice(i * 1000, (i + 1) * 1000).map((r) => ({ ...r, orgId })) }),
    ),
  ]);
}

/**
 * Read Amazon's ledger and reimbursements for the current company: all 18 months the first time,
 * the last 45 days after that. Returns what it stored, or null when Amazon isn't connected.
 */
export async function syncAmazonStockEvents(): Promise<{ ledger: number; lostInbound: number; from: string; to: string } | null> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return null;
  const conn = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn?.refreshTokenEnc) return null;
  const client = makeClient({
    refreshToken: decryptSecret(conn.refreshTokenEnc),
    marketplaceId: conn.marketplaceId ?? "ATVPDKIKX0DER",
    region: conn.region ?? "na",
  });
  const s = await getOrgSettings();
  const first = !s.amazonStockEventsBackfilledAt;
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const from = new Date(today.getTime() - (first ? HISTORY_DAYS : REFRESH_DAYS) * DAY);
  const to = today; // through yesterday: the ledger's today is still being written
  const startISO = from.toISOString().slice(0, 19) + "Z";
  const endISO = new Date(to.getTime() - 1000).toISOString().slice(0, 19) + "Z";

  const ledger = ledgerEvents(await fetchReportText(client, LEDGER, startISO, endISO, { label: "inventory ledger", polls: 90, pollMs: 8000 }));
  // The ledger stamps whole days, so replace whole days — including any edge day it returned.
  let lo = from.getTime();
  let hi = to.getTime();
  for (const e of ledger) {
    const day = Math.floor(e.at.getTime() / DAY) * DAY;
    if (day < lo) lo = day;
    if (day + DAY > hi) hi = day + DAY;
  }
  await replace(orgId, "ledger", new Date(lo), new Date(hi), ledger);

  const lost = reimbursementEvents(await fetchReportText(client, REIMBURSEMENTS, startISO, endISO, { label: "reimbursements", polls: 90, pollMs: 8000 }));
  await replace(orgId, "reimbursement", from, to, lost);

  await saveOrgSettings({ amazonStockEventsSyncedAt: new Date(), ...(first ? { amazonStockEventsBackfilledAt: new Date() } : {}) });
  return { ledger: ledger.length, lostInbound: lost.length, from: startISO.slice(0, 10), to: endISO.slice(0, 10) };
}
