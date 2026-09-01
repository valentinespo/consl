import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-box";
import { makeClient, listFinancialEvents, type FinancialEventsPage, type SpApiClient } from "@/lib/spapi";
import { getOrgSettings, saveOrgSettings } from "@/lib/settings";

/**
 * Amazon's financial ledger → FinanceEvent rows, the raw material of the P&L.
 *
 * The Finances API returns the exact money movements Amazon settles by: item charges, fees,
 * promotions, refunds, ad invoices, storage, reimbursements. We flatten every component to one
 * signed row tagged with a P&L bucket. Amazon gives these events no ids, so imports REPLACE the
 * whole [postedAfter, postedBefore) window in one transaction — re-running any window is a no-op.
 *
 * Date basis is Amazon's PostedDate (when the money moved), the same basis Sellerise and the
 * settlement reports use — so totals reconcile with bank deposits, not with order dates.
 */

export type PnlGroup = "sales" | "refunds" | "fba_fees" | "referral_fees" | "storage_fees" | "advertising" | "taxes" | "other";

type FlatRow = {
  postedAt: Date;
  /** P&L attribution date — rewritten to the order's purchase instant for shipment rows. */
  eventAt: Date;
  group: PnlGroup;
  type: string;
  amount: number;
  orderId: string | null;
  sku: string | null;
  quantity: number | null;
  /** Internal: this row should be re-dated to its order's purchase date (stripped before insert). */
  orderDated?: boolean;
};

const money = (m: unknown): number => {
  const v = (m as { CurrencyAmount?: number } | null)?.CurrencyAmount;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

/** Fee type → bucket, mirroring how the settlement P&L reads: FBA fees = per-order fulfillment
 *  only; inbound/removal/placement programmes live under Other; storage = the monthly FBA storage
 *  fee alone (upstream/STAR storage variants also read as Other). */
function feeGroup(type: string): PnlGroup {
  const t = type.toLowerCase();
  if (t.includes("inbound") || t.includes("removal") || t.includes("placement") || t.includes("disposal")) return "other";
  if (t === "fbastoragefee" || t.includes("longtermstorage")) return "storage_fees";
  if (t.includes("upstreamstorage") || t.includes("starstorage")) return "other";
  if (t.includes("fba") || t.includes("fulfillment")) return "fba_fees";
  if (t.includes("commission") || t.includes("chargeback") || t.includes("closingfee") || t.includes("referral")) return "referral_fees";
  if (t.includes("storage")) return "storage_fees";
  return "other";
}

/** Push one row, dropping zero-amount noise. */
function push(rows: FlatRow[], row: FlatRow) {
  if (row.amount !== 0) rows.push(row);
}

type AnyObj = Record<string, any>;

/** Order-scoped shipment/refund/chargeback events share one nested shape; `mode` decides buckets:
 *  a shipment's components split across sales/fees/taxes, a refund's all land in "refunds". */
function flattenOrderEvent(rows: FlatRow[], ev: AnyObj, mode: "shipment" | "refund", refundType = "Refund") {
  const postedAt = ev.PostedDate ? new Date(ev.PostedDate) : null;
  if (!postedAt || Number.isNaN(postedAt.getTime())) return;
  const orderId: string | null = ev.AmazonOrderId ?? null;
  const items: AnyObj[] = [...(ev.ShipmentItemList ?? []), ...(ev.ShipmentItemAdjustmentList ?? [])];
  const base = { postedAt, eventAt: postedAt, orderId, orderDated: mode === "shipment" } as const;
  for (const item of items) {
    const sku: string | null = item.SellerSKU ?? null;
    const qty: number | null = item.QuantityShipped ?? null;
    const charges: AnyObj[] = [...(item.ItemChargeList ?? []), ...(item.ItemChargeAdjustmentList ?? [])];
    for (const c of charges) {
      const type = String(c.ChargeType ?? "Charge");
      push(rows, {
        ...base,
        sku,
        // Units ride ONLY the shipped Principal rows — one attribution per item, and it is what
        // the COGS calculation multiplies by the FIFO unit cost.
        quantity: mode === "shipment" && type === "Principal" ? qty : null,
        group: mode === "refund" ? "refunds" : "sales",
        type: mode === "refund" ? `${refundType}:${type}` : type,
        amount: money(c.ChargeAmount),
      });
    }
    const fees: AnyObj[] = [...(item.ItemFeeList ?? []), ...(item.ItemFeeAdjustmentList ?? [])];
    for (const f of fees) {
      const type = String(f.FeeType ?? "Fee");
      push(rows, {
        ...base, sku, quantity: null,
        group: mode === "refund" ? "refunds" : feeGroup(type),
        type: mode === "refund" ? `${refundType}:${type}` : type,
        amount: money(f.FeeAmount),
      });
    }
    const promos: AnyObj[] = [...(item.PromotionList ?? []), ...(item.PromotionAdjustmentList ?? [])];
    for (const p of promos) {
      push(rows, {
        ...base, sku, quantity: null,
        group: mode === "refund" ? "refunds" : "sales",
        type: mode === "refund" ? `${refundType}:Promotion` : "Promotion",
        amount: money(p.PromotionAmount),
      });
    }
    const withheld: AnyObj[] = item.ItemTaxWithheldList ?? [];
    for (const w of withheld) {
      for (const c of w.TaxesWithheld ?? []) {
        push(rows, {
          ...base, sku, quantity: null,
          group: mode === "refund" ? "refunds" : "taxes",
          type: mode === "refund" ? `${refundType}:TaxWithheld` : `TaxWithheld:${c.ChargeType ?? ""}`,
          amount: money(c.ChargeAmount),
        });
      }
    }
  }
}

/** One raw Finances page → flat P&L rows. Unhandled event lists are counted, not dropped silently.
 *  `fallbackAt` dates the few event kinds Amazon ships WITHOUT a posted date (service fees like
 *  inbound transportation): it must be inside the imported window, so replace-by-window stays
 *  idempotent — never "now", which would let those rows escape the window and duplicate. */
export function flattenFinancialEvents(page: FinancialEventsPage, unhandled?: Map<string, number>, fallbackAt?: Date): FlatRow[] {
  const rows: FlatRow[] = [];
  const p = page as AnyObj;

  for (const ev of p.ShipmentEventList ?? []) flattenOrderEvent(rows, ev, "shipment");
  for (const ev of p.RefundEventList ?? []) flattenOrderEvent(rows, ev, "refund", "Refund");
  for (const ev of p.GuaranteeClaimEventList ?? []) flattenOrderEvent(rows, ev, "refund", "GuaranteeClaim");
  for (const ev of p.ChargebackEventList ?? []) flattenOrderEvent(rows, ev, "refund", "Chargeback");

  for (const ev of p.ServiceFeeEventList ?? []) {
    // Service fees carry no PostedDate of their own reliably; FeeList components hold the money.
    const postedAt = ev.PostedDate ? new Date(ev.PostedDate) : null;
    for (const f of ev.FeeList ?? []) {
      const reason = String(ev.FeeReason ?? f.FeeType ?? "ServiceFee");
      const t = reason.toLowerCase();
      // Non-order service fees (inbound placement, disposal, subscriptions…) belong in "other" —
      // the FBA-fees bucket is reserved for per-order fulfillment, matching the settlement P&L.
      const sg = feeGroup(reason);
      const group: PnlGroup = sg === "storage_fees" ? "storage_fees" : "other";
      const at = postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : (fallbackAt ?? new Date());
      push(rows, {
        postedAt: at,
        eventAt: at,
        group,
        type: reason,
        amount: money(f.FeeAmount),
        orderId: ev.AmazonOrderId ?? null,
        sku: ev.SellerSKU ?? null,
        quantity: null,
      });
    }
  }

  for (const ev of p.AdjustmentEventList ?? []) {
    const postedAt = ev.PostedDate ? new Date(ev.PostedDate) : null;
    if (!postedAt || Number.isNaN(postedAt.getTime())) continue;
    const type = String(ev.AdjustmentType ?? "Adjustment");
    const group: PnlGroup = type.toLowerCase().includes("storage") ? "storage_fees" : "other";
    // Item list carries per-SKU splits when present; otherwise the event-level total.
    const items: AnyObj[] = ev.AdjustmentItemList ?? [];
    if (items.length) {
      for (const it of items) {
        push(rows, { postedAt, eventAt: postedAt, group, type, amount: money(it.TotalAmount), orderId: null, sku: it.SellerSKU ?? null, quantity: null });
      }
    } else {
      push(rows, { postedAt, eventAt: postedAt, group, type, amount: money(ev.AdjustmentAmount), orderId: null, sku: null, quantity: null });
    }
  }

  for (const ev of p.ProductAdsPaymentEventList ?? []) {
    const postedAt = ev.postedDate ? new Date(ev.postedDate) : null;
    if (!postedAt || Number.isNaN(postedAt.getTime())) continue;
    push(rows, {
      postedAt,
      eventAt: postedAt,
      group: "advertising",
      type: String(ev.transactionType ?? "ProductAds"),
      amount: money(ev.transactionValue) || money(ev.baseValue) + money(ev.taxValue),
      orderId: null, sku: null, quantity: null,
    });
  }

  for (const ev of p.SellerReviewEnrollmentPaymentEventList ?? []) {
    const postedAt = ev.PostedDate ? new Date(ev.PostedDate) : null;
    if (!postedAt || Number.isNaN(postedAt.getTime())) continue;
    const amount = money(ev.ChargeComponent?.ChargeAmount) + money(ev.FeeComponent?.FeeAmount);
    push(rows, { postedAt, eventAt: postedAt, group: "other", type: "VineEnrollmentFee", amount, orderId: null, sku: null, quantity: null });
  }

  for (const ev of p.DebtRecoveryEventList ?? []) {
    // Recovery reduces the payout; some payloads carry no PostedDate — fall back to the charge's.
    const postedAt = ev.PostedDate || ev.DebtRecoveryItemList?.[0]?.GroupBeginDate
      ? new Date(ev.PostedDate ?? ev.DebtRecoveryItemList?.[0]?.GroupBeginDate)
      : (fallbackAt ?? new Date());
    const amount = -Math.abs(money(ev.RecoveryAmount));
    push(rows, { postedAt, eventAt: postedAt, group: "other", type: String(ev.DebtRecoveryType ?? "DebtRecovery"), amount, orderId: null, sku: null, quantity: null });
  }

  for (const ev of p.RemovalShipmentEventList ?? []) {
    const postedAt = ev.PostedDate ? new Date(ev.PostedDate) : null;
    if (!postedAt || Number.isNaN(postedAt.getTime())) continue;
    for (const it of ev.RemovalShipmentItemList ?? []) {
      const amount = money(it.Revenue) + money(it.FeeAmount) + money(it.TaxAmount) + money(it.TaxWithheld);
      push(rows, { postedAt, eventAt: postedAt, group: "other", type: "RemovalShipment", amount, orderId: ev.OrderId ?? null, sku: it.FulfillmentNetworkSKU ?? null, quantity: null });
    }
  }

  for (const ev of p.RetrochargeEventList ?? []) {
    const postedAt = ev.PostedDate ? new Date(ev.PostedDate) : null;
    if (!postedAt || Number.isNaN(postedAt.getTime())) continue;
    const amount = money(ev.BaseTax) + money(ev.ShippingTax);
    push(rows, { postedAt, eventAt: postedAt, group: "taxes", type: String(ev.RetrochargeEventType ?? "Retrocharge"), amount, orderId: ev.AmazonOrderId ?? null, sku: null, quantity: null });
  }

  for (const ev of p.CouponPaymentEventList ?? []) {
    const postedAt = ev.PostedDate ? new Date(ev.PostedDate) : null;
    if (!postedAt || Number.isNaN(postedAt.getTime())) continue;
    const amount = money(ev.TotalAmount) || money(ev.ChargeComponent?.ChargeAmount) + money(ev.FeeComponent?.FeeAmount);
    push(rows, { postedAt, eventAt: postedAt, group: "sales", type: "CouponPayment", amount, orderId: null, sku: null, quantity: null });
  }

  // Anything not modelled above gets counted so a verification pass can see what was skipped.
  if (unhandled) {
    const handled = new Set([
      "ShipmentEventList", "RefundEventList", "GuaranteeClaimEventList", "ChargebackEventList",
      "ServiceFeeEventList", "AdjustmentEventList", "ProductAdsPaymentEventList",
      "SellerReviewEnrollmentPaymentEventList", "DebtRecoveryEventList", "RemovalShipmentEventList",
      "RetrochargeEventList", "CouponPaymentEventList",
    ]);
    for (const [key, list] of Object.entries(p)) {
      if (!handled.has(key) && Array.isArray(list) && list.length > 0) {
        unhandled.set(key, (unhandled.get(key) ?? 0) + list.length);
      }
    }
  }

  return rows;
}

async function amazonClient(): Promise<SpApiClient | null> {
  const conn = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn?.refreshTokenEnc) return null;
  return makeClient({
    refreshToken: decryptSecret(conn.refreshTokenEnc),
    marketplaceId: conn.marketplaceId ?? "ATVPDKIKX0DER",
    region: conn.region ?? "na",
  });
}

/** Import one posted-date window, replacing whatever that window already held. */
export async function importAmazonFinances(postedAfter: Date, postedBefore: Date): Promise<{ rows: number; unhandled: Record<string, number> }> {
  const client = await amazonClient();
  if (!client) return { rows: 0, unhandled: {} };
  const unhandled = new Map<string, number>();
  const pages = await listFinancialEvents(client, postedAfter, postedBefore);
  const rows = pages.flatMap((page) => flattenFinancialEvents(page, unhandled, postedAfter));
  // Re-date shipment money onto its order's purchase instant — the day a seller reads it under.
  const orderIds = [...new Set(rows.filter((r) => r.orderDated && r.orderId).map((r) => r.orderId as string))];
  const orderedAt = new Map<string, Date>();
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = await prisma.salesOrder.findMany({
      where: { channel: "AMAZON", externalId: { in: orderIds.slice(i, i + 500) } },
      select: { externalId: true, orderedAt: true },
    });
    for (const o of chunk) orderedAt.set(o.externalId, o.orderedAt);
  }
  for (const r of rows) {
    if (r.orderDated && r.orderId) r.eventAt = orderedAt.get(r.orderId) ?? r.postedAt;
  }
  // Replace-by-window: delete + insert atomically so a crash can never leave a half-window.
  await prisma.$transaction([
    prisma.financeEvent.deleteMany({ where: { channel: "AMAZON", postedAt: { gte: postedAfter, lt: postedBefore } } }),
    ...(rows.length
      ? [prisma.financeEvent.createMany({
          data: rows.map(({ orderDated: _drop, ...r }) => ({ channel: "AMAZON", ...r })),
        })]
      : []),
  ], { timeout: 120_000, maxWait: 15_000 }); // a 7-day window can carry thousands of rows
  if (unhandled.size > 0) console.log("[finances] unhandled event lists:", Object.fromEntries(unhandled));
  return { rows: rows.length, unhandled: Object.fromEntries(unhandled) };
}

// Small windows on purpose: the handful of event kinds Amazon ships undated (service fees) get
// dated at the window start, so a tighter window keeps them within days of the truth.
const BACKFILL_WINDOW_DAYS = 7;
const BACKFILL_FLOOR_DAYS = 730; // matches the orders walk — about two years back

/** One backward step of the history walk (scheduler-driven, like the orders backfill). */
export async function backfillAmazonFinancesStep(): Promise<{ done: boolean; rows: number; cursor: string }> {
  const client = await amazonClient();
  if (!client) return { done: true, rows: 0, cursor: "" };
  const s = await getOrgSettings();
  const floor = new Date(Date.now() - BACKFILL_FLOOR_DAYS * 86_400_000);
  // First step starts at now − 3 min: the API refuses a PostedBefore within 2 minutes of now.
  const cursorEnd = s.financeBackfillCursor ? new Date(s.financeBackfillCursor) : new Date(Date.now() - 3 * 60_000);
  if (cursorEnd <= floor) return { done: true, rows: 0, cursor: s.financeBackfillCursor ?? "" };
  const start = new Date(Math.max(floor.getTime(), cursorEnd.getTime() - BACKFILL_WINDOW_DAYS * 86_400_000));
  const r = await importAmazonFinances(start, cursorEnd);
  await saveOrgSettings({ financeBackfillCursor: start.toISOString() });
  return { done: start.getTime() <= floor.getTime(), rows: r.rows, cursor: start.toISOString() };
}

/** The live leg: sweep [cursor − overlap, now − 2 min) forward. Replace-by-window makes the
 *  overlap free, and the 2-minute stand-off is the Finances API's own PostedBefore requirement. */
export async function sweepAmazonFinances(): Promise<{ rows: number } | null> {
  const client = await amazonClient();
  if (!client) return null;
  const s = await getOrgSettings();
  const end = new Date(Date.now() - 2 * 60_000);
  const from = s.financeEventsCursor ? new Date(new Date(s.financeEventsCursor).getTime() - 60 * 60_000) : new Date(Date.now() - 3 * 86_400_000);
  if (end.getTime() - from.getTime() < 10 * 60_000) return { rows: 0 };
  const r = await importAmazonFinances(from, end);
  await saveOrgSettings({ financeEventsCursor: end.toISOString() });
  return { rows: r.rows };
}
