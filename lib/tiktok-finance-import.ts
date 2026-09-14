import "server-only";
import { prisma } from "@/lib/prisma";
import { getOrgSettings, saveOrgSettings } from "@/lib/settings";
import { tiktokApi } from "@/lib/tiktok";
import { getTikTokAccessToken } from "@/lib/tiktok-oauth";
import { IMPORTER_VERSIONS, importerVersion, stampImporterVersion } from "@/lib/import-versions";
import { upsertTikTokFinanceEvents, type TikTokStatementLine, type TikTokStatementTransaction } from "@/lib/tiktok-finances";
import type { PnlGroup } from "@/lib/finances";

/**
 * TikTok Shop's settlement ledger from the Finance API (scope seller.finance.info) → FinanceEvent
 * rows, through lib/tiktok-finances.ts. Four reads, every quarter hour:
 *  - statements (daily, /finance/202309/statements) from the marker minus an overlap — a
 *    statement's payment status flips PROCESSING → PAID days after it is cut;
 *  - each statement's transactions (/finance/202501/statements/{id}/statement_transactions): one
 *    per ORDER with the money split by section, plus ADJUSTMENT / RESERVE lines, booked as their
 *    own rows so a payout always adds up;
 *  - the order's SKU split (/finance/202501/orders/{id}/statement_transactions), read once per
 *    transaction consl hasn't booked yet, so a multi-SKU order shares its money by SKU exactly as
 *    TikTok does (the "Gross sales" row per SKU carries the units — the COGS driver);
 *  - unsettled orders (/finance/202507/orders/unsettled): delivered-but-unpaid money as HELD rows
 *    with TikTok's estimated payout date, replaced by the settled rows when the statement lands
 *    and dropped when TikTok no longer lists them.
 *
 * Every line is one of TikTok's named amounts. Known names carry the labels the P&L already uses;
 * an unknown name is still booked (humanised, best-guess bucket), and a balancing line keeps
 * each section equal to TikTok's own section total — nothing TikTok settled can go missing.
 * The first pass after a connection (or after an importer generation bump) reads everything the
 * shop has; later passes re-read the overlap window and skip transactions already booked in the
 * same state, so a pass is cheap.
 */

const DAY = 86_400_000;
const OVERLAP_DAYS = 30;
const STATEMENTS_V = "202309";
const TRANSACTIONS_V = "202501";
const UNSETTLED_V = "202507";

type Statement = { id: string; statement_time: number; currency?: string | null; payment_status?: string | null; payment_time?: number | null; settlement_amount?: string | null };
type Breakdown = Record<string, string | number | null | Record<string, unknown> | undefined>;
type StatementTx = {
  id: string;
  type?: string | null; // ORDER | ADJUSTMENT | RESERVE …
  order_id?: string | null;
  order_create_time?: number | null; // s
  adjustment_id?: string | null;
  adjustment_order_id?: string | null;
  adjustment_amount?: string | null;
  settlement_amount?: string | null;
  revenue_amount?: string | null;
  revenue_breakdown?: Breakdown | null;
  shipping_cost_amount?: string | null;
  shipping_cost_breakdown?: Breakdown | null;
  fee_tax_amount?: string | null;
  fee_tax_breakdown?: { fee?: Breakdown | null; tax?: Breakdown | null } | null;
  currency?: string | null;
};
type UnsettledTx = StatementTx & {
  status?: string | null;
  estimated_settlement?: string | number | null; // s
  est_settlement_amount?: string | null;
  est_revenue_amount?: string | null;
  est_shipping_cost_amount?: string | null;
  est_fee_tax_amount?: string | null;
  est_adjustment_amount?: string | null;
};
type SkuTx = { sku_id: string; statement_id?: string | null; quantity?: string | number | null; revenue_amount?: string | null };

type LineSpec = { name: string; group: PnlGroup };
type Section = "revenue" | "shipping" | "fee" | "tax";

// Labels the P&L already carries (the Seller Center load used TikTok's own wording) and the
// bucket each lands in. Anything not listed falls through to `guess`.
const KNOWN: Record<string, LineSpec> = {
  // revenue
  subtotal_before_discount_amount: { name: "Gross sales", group: "sales" },
  seller_discount_amount: { name: "Seller discount", group: "sales" },
  refund_subtotal_before_discount_amount: { name: "Gross sales refund", group: "refunds" },
  seller_discount_refund_amount: { name: "Seller discount refund", group: "refunds" },
  cod_service_fee_amount: { name: "COD service fee", group: "sales" },
  refund_cod_service_fee_amount: { name: "COD service fee refund", group: "refunds" },
  distant_item_fee_amount: { name: "Distant item fee", group: "sales" },
  // shipping
  customer_paid_shipping_fee_amount: { name: "Customer-paid shipping fee", group: "sales" },
  return_shipping_fee_paid_buyer_amount: { name: "Return shipping fee paid by buyer", group: "sales" },
  actual_shipping_fee_amount: { name: "Shipping fee", group: "fba_fees" },
  shipping_fee_discount_amount: { name: "Shipping fee discount", group: "fba_fees" },
  return_shipping_fee_amount: { name: "Return shipping fee", group: "fba_fees" },
  replacement_shipping_fee_amount: { name: "Replacement shipping fee", group: "fba_fees" },
  exchange_shipping_fee_amount: { name: "Exchange shipping fee", group: "fba_fees" },
  signature_confirmation_fee_amount: { name: "Signature confirmation fee", group: "fba_fees" },
  shipping_insurance_fee_amount: { name: "Shipping insurance fee", group: "fba_fees" },
  fbt_fulfillment_fee_reimbursement_amount: { name: "FBT fulfillment fee reimbursement", group: "fba_fees" },
  return_shipping_label_fee_amount: { name: "Return shipping label fee", group: "fba_fees" },
  seller_self_shipping_service_fee_amount: { name: "Seller self-shipping service fee", group: "fba_fees" },
  failed_delivery_subsidy_amount: { name: "Failed delivery subsidy", group: "fba_fees" },
  fbt_free_shipping_fee_amount: { name: "FBT free shipping fee", group: "fba_fees" },
  free_return_subsidy_amount: { name: "Free return subsidy", group: "fba_fees" },
  distant_shipping_fee_amount: { name: "Distant shipping fee", group: "fba_fees" },
  shipping_app_service_fee_amount: { name: "Shipping app service fee", group: "fba_fees" },
  logistics_service_fee: { name: "Logistics service fee", group: "fba_fees" },
  international_leg_logistics_amount: { name: "International leg logistics", group: "fba_fees" },
  tiktok_shop_shipping_incentive_amount: { name: "TikTok Shop shipping incentive", group: "fba_fees" },
  // fees
  platform_commission_amount: { name: "Platform commission", group: "referral_fees" },
  referral_fee_amount: { name: "Referral fee", group: "referral_fees" },
  platform_semi_managed_commission_fee: { name: "Semi-managed commission fee", group: "referral_fees" },
  platform_semi_managed_commission_fee_tax: { name: "Semi-managed commission fee tax", group: "referral_fees" },
  refund_administration_fee_amount: { name: "Refund administration fee", group: "other" },
  transaction_fee_amount: { name: "Transaction fee", group: "payment_fees" },
  credit_card_handling_fee_amount: { name: "Credit card handling fee", group: "payment_fees" },
  seller_paylater_handling_fee_amount: { name: "Seller PayLater handling fee", group: "payment_fees" },
  affiliate_commission_amount: { name: "Affiliate Commission", group: "advertising" },
  affiliate_partner_commission_amount: { name: "Affiliate partner commission", group: "advertising" },
  affiliate_ads_commission_amount: { name: "Affiliate ads commission", group: "advertising" },
  affiliate_commission_deposit: { name: "Affiliate commission deposit", group: "advertising" },
  affiliate_commission_release: { name: "Affiliate commission release", group: "advertising" },
  external_affiliate_marketing_fee_amount: { name: "External affiliate marketing fee", group: "advertising" },
  dynamic_commission_amount: { name: "Dynamic commission", group: "advertising" },
  smart_promotion_fee_amount: { name: "Smart Promotion fee", group: "advertising" },
  campaign_period_fee_sp_amount: { name: "Smart Promotion campaign period fee", group: "advertising" },
  campaign_period_fee_sp_tax_amount: { name: "Smart Promotion campaign period fee tax", group: "advertising" },
  campaign_period_fee_cfp_amount: { name: "Co-funded promotion campaign period fee", group: "advertising" },
  campaign_period_fee_cfp_tax_amount: { name: "Co-funded promotion campaign period fee tax", group: "advertising" },
  cofunded_promotion_service_fee_amount: { name: "Co-funded promotion service fee", group: "advertising" },
  cofunded_creator_bonus_amount: { name: "Co-funded creator bonus", group: "advertising" },
  gmv_max_ad_fee_amount: { name: "GMV Max ad fee", group: "advertising" },
  tap_shop_ads_commission: { name: "Shop ads commission", group: "advertising" },
  cps_shop_ads_commission_tax_amount: { name: "Shop ads commission tax", group: "advertising" },
  live_specials_fee_amount: { name: "LIVE specials fee", group: "advertising" },
  flash_sales_service_fee_amount: { name: "Flash sales service fee", group: "advertising" },
  voucher_xtra_service_fee_amount: { name: "Voucher Xtra service fee", group: "advertising" },
  bonus_cashback_service_fee_amount: { name: "Bonus cashback service fee", group: "advertising" },
  campaign_resource_fee: { name: "Campaign resource fee", group: "advertising" },
  sfp_service_fee_amount: { name: "SFP service fee", group: "other" },
  mall_service_fee_amount: { name: "Mall service fee", group: "other" },
  pre_order_service_fee_amount: { name: "Pre-order service fee", group: "other" },
  tsp_commission_amount: { name: "TSP commission", group: "other" },
  dt_handling_fee_amount: { name: "DT handling fee", group: "other" },
  epr_pob_service_fee_amount: { name: "EPR/POB service fee", group: "other" },
  fee_per_item_sold_amount: { name: "Fee per item sold", group: "other" },
  platform_special_service_fee_amount: { name: "Platform special service fee", group: "other" },
  seller_growth_fee_amount: { name: "Seller growth fee", group: "other" },
  installation_service_fee: { name: "Installation service fee", group: "other" },
  shipping_fee_guarantee_service_fee: { name: "Shipping fee guarantee service fee", group: "fba_fees" },
  failed_delivery_shipping_fee: { name: "Failed delivery shipping fee", group: "fba_fees" },
  buyer_fault_return_shipping_fee: { name: "Buyer-fault return shipping fee", group: "fba_fees" },
  insurance_fee: { name: "Insurance fee", group: "other" },
  shipping_insurance_fee_tax_amount: { name: "Shipping insurance fee tax", group: "other" },
  vn_fix_infrastructure_fee: { name: "Infrastructure fee", group: "other" },
  // taxes (marketplace-facilitator taxes net to zero: collected, then remitted by TikTok)
  sales_tax_amount: { name: "Sales tax", group: "taxes" },
  sales_tax_payment_amount: { name: "Sales tax payment", group: "taxes" },
  sales_tax_refund_amount: { name: "Sales tax refund", group: "taxes" },
  sales_tax_referral_fee_amount: { name: "Sales tax on referral fee", group: "taxes" },
  smart_promotion_fee_tax_amount: { name: "Smart Promotion fee tax", group: "taxes" },
  retail_delivery_fee_amount: { name: "Retail delivery fee", group: "taxes" },
  retail_delivery_fee_payment_amount: { name: "Retail delivery fee payment", group: "taxes" },
  retail_delivery_fee_refund_amount: { name: "Retail delivery fee refund", group: "taxes" },
  vat_amount: { name: "VAT", group: "taxes" },
  import_vat_amount: { name: "Import VAT", group: "taxes" },
  customs_duty_amount: { name: "Customs duty", group: "taxes" },
  customs_clearance_amount: { name: "Customs clearance", group: "taxes" },
  sst_amount: { name: "SST", group: "taxes" },
  gst_amount: { name: "GST", group: "taxes" },
  cedular_tax: { name: "Cedular tax", group: "taxes" },
};

// Informational companions of another line (the amount before a withholding, the withholding
// itself) — booking them would count the same money twice.
const SKIP = /before_pit|pit_withheld/;

const ACRONYMS = new Set(["fbt", "fbm", "cod", "sfp", "tsp", "dt", "epr", "pob", "gmv", "vn", "cps", "tap", "sst", "gst", "vat", "tiktok"]);
function humanise(key: string): string {
  const words = key.replace(/_amount$/, "").split("_").filter(Boolean);
  return words.map((w, i) => (ACRONYMS.has(w) ? (w === "tiktok" ? "TikTok" : w.toUpperCase()) : i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

/** A name TikTok added since this table was written: still booked, in the most likely bucket. */
function guess(section: Section, key: string): LineSpec {
  const k = key.toLowerCase();
  const group: PnlGroup =
    section === "tax" || /(^|_)tax(_|$)|_vat|duty/.test(k)
      ? "taxes"
      : section === "revenue"
        ? /refund/.test(k) ? "refunds" : "sales"
        : section === "shipping"
          ? /customer_paid|paid_buyer/.test(k) ? "sales" : "fba_fees"
          : /platform_commission|referral|semi_managed/.test(k)
            ? "referral_fees"
            : /affiliate|promotion|ads?_|_ad_|campaign|creator|commission|live_specials|flash_sales|voucher|cashback|marketing/.test(k)
              ? "advertising"
              : /transaction_fee|credit_card|paylater|handling_fee/.test(k)
                ? "payment_fees"
                : /shipping|delivery|logistics|return/.test(k)
                  ? "fba_fees"
                  : "other";
  return { name: humanise(key), group };
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** One breakdown object → its lines (nested objects are detail of lines already present — skipped). */
function linesOf(section: Section, obj: Breakdown | null | undefined): TikTokStatementLine[] {
  const out: TikTokStatementLine[] = [];
  for (const [key, raw] of Object.entries(obj ?? {})) {
    if (raw === null || raw === undefined || typeof raw === "object") continue;
    if (SKIP.test(key)) continue;
    const amount = num(raw);
    if (amount === 0) continue;
    const spec = KNOWN[key] ?? guess(section, key);
    out.push({ type: key, name: spec.name, amount: String(amount), group: spec.group });
  }
  return out;
}

/** A section's lines must add up to TikTok's own section total; the difference (a name we did
 *  not receive as a line) is booked as one balancing line so the payout still reconciles. */
function balanced(lines: TikTokStatementLine[], total: unknown, fallback: { name: string; group: PnlGroup }): TikTokStatementLine[] {
  const want = num(total);
  const have = lines.reduce((t, l) => t + num(l.amount), 0);
  const diff = r2(want - have);
  // A cent or two is TikTok's own rounding between its lines and its total; anything bigger is a
  // line we did not receive.
  if (Math.abs(diff) >= 0.005) lines.push({ type: "unlisted", name: Math.abs(diff) < 0.05 ? "Rounding" : fallback.name, amount: String(diff), group: Math.abs(diff) < 0.05 ? "other" : fallback.group });
  return lines;
}

export function moneyLines(t: StatementTx, totals: { revenue: unknown; shipping: unknown; feeTax: unknown; adjustment: unknown; settlement: unknown }) {
  const revenue = balanced(linesOf("revenue", t.revenue_breakdown), totals.revenue, { name: "Sales not itemised", group: "sales" });
  const shipping = balanced(linesOf("shipping", t.shipping_cost_breakdown), totals.shipping, { name: "Shipping not itemised", group: "fba_fees" });
  const fees = balanced([...linesOf("fee", t.fee_tax_breakdown?.fee), ...linesOf("tax", t.fee_tax_breakdown?.tax)], totals.feeTax, { name: "Fees not itemised", group: "other" });
  const adj = num(totals.adjustment);
  if (adj !== 0) fees.push({ type: "adjustment", name: (t.type ?? "").toUpperCase() === "RESERVE" ? "Reserve" : "Adjustment", amount: String(adj), group: "other" });
  // The whole transaction must equal what TikTok settled for it.
  const all = [...revenue, ...shipping, ...fees].reduce((s, l) => s + num(l.amount), 0);
  const diff = r2(num(totals.settlement) - all);
  if (Math.abs(diff) >= 0.005) fees.push({ type: "unlisted", name: Math.abs(diff) < 0.05 ? "Rounding" : "Settlement not itemised", amount: String(diff), group: "other" });
  return { revenue, shipping, fees };
}

type OrderLines = { sku_id: string; seller_sku: string | null; quantity: number; revenue: number }[];

/** The stored order's lines (seller SKU, units, net revenue) — the SKU split when TikTok gives none. */
async function storedOrderLines(orderIds: string[]): Promise<Map<string, OrderLines>> {
  const out = new Map<string, OrderLines>();
  if (orderIds.length === 0) return out;
  const orders = await prisma.salesOrder.findMany({
    where: { channel: "TIKTOK", externalId: { in: orderIds } },
    select: { externalId: true, sourceData: true, lines: { select: { sku: true, quantity: true, unitPrice: true } } },
  });
  for (const o of orders) {
    const sd = o.sourceData as { line_items?: Array<{ sku_id?: string | null; seller_sku?: string | null }> } | null;
    const idBySku = new Map<string, string>();
    for (const li of sd?.line_items ?? []) if (li.seller_sku && li.sku_id) idBySku.set(li.seller_sku, li.sku_id);
    out.set(
      o.externalId,
      o.lines.map((l) => ({ sku_id: (l.sku && idBySku.get(l.sku)) || l.sku || "?", seller_sku: l.sku, quantity: l.quantity, revenue: r2(l.unitPrice * l.quantity) })),
    );
  }
  return out;
}

async function paged<T>(fetchPage: (token: string | null) => Promise<{ items: T[]; next: string | null }>, cap = 400): Promise<T[]> {
  const out: T[] = [];
  let token: string | null = null;
  for (let i = 0; i < cap; i++) {
    const { items, next } = await fetchPage(token);
    out.push(...items);
    if (!next) break;
    token = next;
  }
  return out;
}

export type TikTokFinanceResult = { statements: number; booked: number; unsettled: number; rows: number; full: boolean };

/** One pass of TikTok's settlement ledger for the current org (no-op when TikTok isn't connected). */
export async function importTikTokFinance(): Promise<TikTokFinanceResult> {
  const zero: TikTokFinanceResult = { statements: 0, booked: 0, unsettled: 0, rows: 0, full: false };
  const conn = await prisma.integration.findFirst({ where: { provider: "tiktok", status: "connected" } });
  if (!conn?.marketplaceId || !conn.refreshTokenEnc) return zero;
  const token = await getTikTokAccessToken(conn);
  const cipher = conn.marketplaceId;
  const settings = await getOrgSettings();
  const full = importerVersion(settings.importerVersions, "tiktokFinance") < IMPORTER_VERSIONS.tiktokFinance || !settings.tiktokFinanceSyncedThrough;
  const since = full || !settings.tiktokFinanceSyncedThrough ? null : new Date(settings.tiktokFinanceSyncedThrough.getTime() - OVERLAP_DAYS * DAY);
  const passStart = new Date();
  let rows = 0;

  // 1. Statements in the window (oldest first), then every transaction of each.
  const statements = await paged<Statement>(async (pt) => {
    const d = await tiktokApi<{ statements?: Statement[] | null; next_page_token?: string | null }>({
      method: "GET",
      path: `/finance/${STATEMENTS_V}/statements`,
      accessToken: token,
      query: {
        shop_cipher: cipher,
        page_size: "100",
        sort_field: "statement_time",
        sort_order: "ASC",
        ...(since ? { statement_time_ge: String(Math.floor(since.getTime() / 1000)) } : {}),
        ...(pt ? { page_token: pt } : {}),
      },
    });
    return { items: d.statements ?? [], next: d.next_page_token || null };
  });

  // What is already booked, and in which state — a transaction booked in the same state is skipped.
  const bookedState = new Map<string, string>();
  for (const r of await prisma.financeEvent.findMany({ where: { channel: "TIKTOK", txId: { not: null } }, select: { txId: true, status: true }, distinct: ["txId", "status"] })) {
    if (r.txId) bookedState.set(r.txId, r.status ?? "released");
  }

  const pending: { st: Statement; t: StatementTx }[] = [];
  for (const st of statements) {
    const txs = await paged<StatementTx>(async (pt) => {
      const d = await tiktokApi<{ transactions?: StatementTx[] | null; next_page_token?: string | null }>({
        method: "GET",
        path: `/finance/${TRANSACTIONS_V}/statements/${st.id}/statement_transactions`,
        accessToken: token,
        query: { shop_cipher: cipher, page_size: "100", sort_field: "order_create_time", sort_order: "ASC", ...(pt ? { page_token: pt } : {}) },
      });
      return { items: d.transactions ?? [], next: d.next_page_token || null };
    });
    const state = (st.payment_status ?? "").toUpperCase() === "PAID" ? "released" : "held";
    for (const t of txs) if (bookedState.get(t.id) !== state) pending.push({ st, t });
  }

  // 2. SKU split for the order transactions to book: TikTok's own per-order split, else the
  //    stored order's lines.
  const orderIds = [...new Set(pending.map((p) => p.t.order_id ?? p.t.adjustment_order_id).filter((x): x is string => !!x))];
  const stored = await storedOrderLines(orderIds);
  const skuSplit = new Map<string, SkuTx[]>(); // order id → TikTok's split (all statements)
  for (const orderId of orderIds) {
    if (!pending.some((p) => (p.t.type ?? "ORDER").toUpperCase() === "ORDER" && p.t.order_id === orderId)) continue;
    try {
      const d = await tiktokApi<{ sku_transactions?: SkuTx[] | null }>({
        method: "GET",
        path: `/finance/${TRANSACTIONS_V}/orders/${orderId}/statement_transactions`,
        accessToken: token,
        query: { shop_cipher: cipher },
      });
      skuSplit.set(orderId, d.sku_transactions ?? []);
    } catch (e) {
      console.warn(`[tiktok finance] sku split unavailable for order ${orderId}: ${(e as Error).message}`);
    }
  }

  const settled: TikTokStatementTransaction[] = [];
  for (const { st, t } of pending) {
    const paid = (st.payment_status ?? "").toUpperCase() === "PAID";
    const orderId = t.order_id ?? t.adjustment_order_id ?? `statement:${st.id}:${t.id}`;
    const lines = moneyLines(t, { revenue: t.revenue_amount, shipping: t.shipping_cost_amount, feeTax: t.fee_tax_amount, adjustment: t.adjustment_amount, settlement: t.settlement_amount });
    const own = stored.get(orderId) ?? [];
    const sellerSkuById = new Map(own.map((l) => [l.sku_id, l.seller_sku]));
    const fromTikTok = (skuSplit.get(orderId) ?? []).filter((s) => !s.statement_id || s.statement_id === st.id);
    const skus =
      fromTikTok.length > 0
        ? fromTikTok.map((s) => ({ sku_id: s.sku_id, seller_sku: sellerSkuById.get(s.sku_id) ?? null, quantity: Math.max(0, Math.round(num(s.quantity))), revenue_amount: String(num(s.revenue_amount)) }))
        : own.map((l) => ({ sku_id: l.sku_id, seller_sku: l.seller_sku, quantity: l.quantity, revenue_amount: String(l.revenue) }));
    settled.push({
      id: t.id,
      order_id: orderId,
      statement_id: st.id,
      order_create_time: (t.order_create_time ?? st.statement_time) * 1000,
      statement_time: st.statement_time * 1000,
      settlement_time: paid ? (st.payment_time ?? st.statement_time) * 1000 : null,
      estimated_settlement_time: null,
      status: paid ? "PAID" : "TO_SETTLE",
      currency: t.currency ?? st.currency ?? "USD",
      revenue_breakdown: lines.revenue,
      shipping_breakdown: lines.shipping,
      fee_breakdown: lines.fees,
      sku_statement_transactions: skus,
    });
  }
  if (settled.length > 0) {
    // Settled money replaces the held estimate of the same orders.
    const releasedOrders = settled.filter((s) => s.status === "PAID").map((s) => s.order_id);
    if (releasedOrders.length) await prisma.financeEvent.deleteMany({ where: { channel: "TIKTOK", status: "held", orderId: { in: releasedOrders } } });
    for (let i = 0; i < settled.length; i += 200) rows += (await upsertTikTokFinanceEvents(settled.slice(i, i + 200))).rows;
  }

  // 3. Unsettled money: everything TikTok still owes, as held rows with the estimated payout date.
  const unsettled = await paged<UnsettledTx>(async (pt) => {
    const d = await tiktokApi<{ transactions?: UnsettledTx[] | null; next_page_token?: string | null }>({
      method: "GET",
      path: `/finance/${UNSETTLED_V}/orders/unsettled`,
      accessToken: token,
      query: { shop_cipher: cipher, page_size: "100", sort_field: "order_create_time", sort_order: "ASC", ...(pt ? { page_token: pt } : {}) },
    });
    return { items: d.transactions ?? [], next: d.next_page_token || null };
  });
  const unsettledOrders = await storedOrderLines([...new Set(unsettled.map((u) => u.order_id).filter((x): x is string => !!x))]);
  const held: TikTokStatementTransaction[] = [];
  for (const u of unsettled) {
    if (bookedState.get(u.id) === "released") continue; // already paid — the statement rows win
    const orderId = u.order_id ?? u.adjustment_order_id ?? `unsettled:${u.id}`;
    const lines = moneyLines(u, { revenue: u.est_revenue_amount, shipping: u.est_shipping_cost_amount, feeTax: u.est_fee_tax_amount, adjustment: u.est_adjustment_amount, settlement: u.est_settlement_amount });
    const own = unsettledOrders.get(orderId) ?? [];
    held.push({
      id: u.id,
      order_id: orderId,
      statement_id: null,
      order_create_time: (u.order_create_time ?? Math.floor(Date.now() / 1000)) * 1000,
      statement_time: null,
      settlement_time: null,
      estimated_settlement_time: u.estimated_settlement ? num(u.estimated_settlement) * 1000 : null,
      status: "TO_SETTLE",
      currency: u.currency ?? "USD",
      revenue_breakdown: lines.revenue,
      shipping_breakdown: lines.shipping,
      fee_breakdown: lines.fees,
      sku_statement_transactions: own.map((l) => ({ sku_id: l.sku_id, seller_sku: l.seller_sku, quantity: l.quantity, revenue_amount: String(l.revenue) })),
    });
  }
  for (let i = 0; i < held.length; i += 200) rows += (await upsertTikTokFinanceEvents(held.slice(i, i + 200))).rows;
  // A held row TikTok no longer lists as unsettled and that no statement in the window carries
  // has either settled (its released rows are in) or was cancelled: drop it. Three days of grace
  // so a momentary gap in TikTok's answer never removes live money.
  const keep = [...new Set([...unsettled.map((u) => u.id), ...pending.map((p) => p.t.id)])];
  await prisma.financeEvent.deleteMany({
    where: { channel: "TIKTOK", status: "held", createdAt: { lt: new Date(Date.now() - 3 * DAY) }, ...(keep.length ? { txId: { notIn: keep } } : {}) },
  });

  await saveOrgSettings({
    tiktokFinanceSyncedThrough: passStart,
    ...(full ? { importerVersions: stampImporterVersion(settings.importerVersions, "tiktokFinance") } : {}),
  });
  return { statements: statements.length, booked: settled.length, unsettled: held.length, rows, full };
}
