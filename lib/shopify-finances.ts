import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { getCurrentOrg } from "@/lib/org";
import { fxRate } from "@/lib/fx";
import { shopifyGraphQL } from "@/lib/shopify";
import type { PnlGroup } from "@/lib/finances";

/**
 * A Shopify order's money → FinanceEvent rows (channel SHOPIFY), so Shopify adds up like the
 * other channels: product sales per line (with units — the unit driver, like Amazon's Principal),
 * shipping charged, the sales tax collected AND the same amount remitted (a pass-through: the
 * customer pays it, the merchant hands it to the state, it is never income — it nets to zero,
 * exactly as Amazon's facilitator tax does), the processing fee Shopify Payments took, each
 * refund on the day it was issued, and a chargeback the merchant lost.
 *
 * Shopify has no settlement lag worth bridging: an order carries its own money the moment it is
 * placed, so the rows are written straight from the order at import time and rewritten on every
 * re-import (edits, refunds, disputes) — the order id is the transaction key. Rows are written
 * only for orders with at least one line the company manages here; unmanaged lines are left out
 * like Amazon's unmapped listings.
 *
 * Money Shopify Payments itself moves — the processing fee it kept on each charge, a chargeback
 * and its dispute fee, an adjustment — comes from the Shopify Payments balance ledger (the
 * "Transactions" list under Finance), row by row, when the connection carries the payments
 * scopes. A connection without them falls back to the fee the order's own transaction reports and
 * to the order's dispute status, which lack the dispute fee.
 */

/** Whether a connection's granted scope lets consl read the Shopify Payments ledger. */
export function hasShopifyPaymentsScope(scope: string | null | undefined): boolean {
  return (scope ?? "").split(",").map((s) => s.trim()).includes("read_shopify_payments_payouts");
}

type Money = { shopMoney: { amount: string; currencyCode?: string } } | null | undefined;

export type ShopifyFinanceNode = {
  id: string;
  createdAt: string;
  updatedAt?: string | null;
  cancelledAt?: string | null;
  currentTotalPriceSet?: Money;
  totalTaxSet?: Money;
  totalShippingPriceSet?: Money;
  lineItems: {
    nodes: Array<{
      sku: string | null;
      quantity: number;
      variant: { id: string } | null;
      discountedUnitPriceSet?: Money;
      originalUnitPriceSet?: Money;
    }>;
  };
  transactions?: Array<{ kind: string; status: string; fees?: Array<{ type?: string | null; amount: { amount: string } }> | null }> | null;
  refunds?: Array<{
    id: string;
    createdAt: string;
    totalRefundedSet?: Money;
    refundLineItems?: { nodes: Array<{ quantity: number; subtotalSet?: Money; totalTaxSet?: Money; lineItem: { sku: string | null; variant: { id: string } | null } | null }> } | null;
  }> | null;
  disputes?: Array<{ id: string; status?: string | null }> | null;
};

type Row = {
  postedAt: Date;
  eventAt: Date;
  group: PnlGroup;
  type: string;
  amount: number;
  orderId: string;
  sku: string | null;
  quantity: number | null;
  txId: string;
  status: "released";
  releasedAt: null;
  currency: string;
  baseAmount: number;
};

const num = (m: Money | string | null | undefined): number => {
  const v = typeof m === "string" ? m : m?.shopMoney?.amount;
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** One order → its rows. `resolve` says which lines the company manages (null = not ours). */
export function flattenShopifyOrder(
  o: ShopifyFinanceNode,
  resolve: (line: { sku: string | null; variantId?: string }) => string | null,
  /** True when the Shopify Payments ledger supplies fees and chargebacks — the order then carries only its sales, tax and refunds. */
  ledgerFees = false,
): Row[] {
  if (o.cancelledAt) return [];
  const currency = o.currentTotalPriceSet?.shopMoney?.currencyCode ?? "USD";
  const placedAt = new Date(o.createdAt);
  const lineKey = (l: { sku: string | null; variant: { id: string } | null }) => l.sku?.trim() || l.variant?.id || null;
  const managed = o.lineItems.nodes.filter((l) => resolve({ sku: l.sku?.trim() || null, variantId: l.variant?.id }) !== null);
  if (managed.length === 0) return [];

  const rows: Row[] = [];
  const base = { orderId: o.id, txId: o.id, status: "released" as const, releasedAt: null, currency, baseAmount: 0, postedAt: placedAt, eventAt: placedAt };
  const push = (r: Partial<Row> & { group: PnlGroup; type: string; amount: number }) => {
    if (r.amount === 0) return;
    rows.push({ ...base, sku: null, quantity: null, ...r, amount: round2(r.amount) });
  };

  for (const l of managed) {
    const unit = num(l.discountedUnitPriceSet ?? l.originalUnitPriceSet);
    push({ group: "sales", type: "Product sales", amount: l.quantity * unit, sku: lineKey(l), quantity: l.quantity });
  }
  push({ group: "sales", type: "Shipping", amount: num(o.totalShippingPriceSet) });
  const tax = num(o.totalTaxSet);
  push({ group: "sales", type: "Tax collected", amount: tax });
  push({ group: "taxes", type: "Tax remitted", amount: -tax });

  // What Shopify Payments kept on the capture(s) — only when the ledger isn't the source.
  if (!ledgerFees) {
    let fees = 0;
    for (const t of o.transactions ?? []) {
      if (t.status !== "SUCCESS" || !["SALE", "CAPTURE"].includes(t.kind)) continue;
      for (const f of t.fees ?? []) fees += num(f.amount.amount);
    }
    push({ group: "payment_fees", type: "Processing fee", amount: -fees });
  }

  // Refunds land on the day they were issued: the product part per line, the tax part on both
  // sides of the pass-through, whatever is left (shipping, goodwill) as its own line.
  for (const r of o.refunds ?? []) {
    const at = new Date(r.createdAt);
    const total = num(r.totalRefundedSet);
    let lines = 0;
    let lineTax = 0;
    for (const rl of r.refundLineItems?.nodes ?? []) {
      const sub = num(rl.subtotalSet);
      const t = num(rl.totalTaxSet);
      lines += sub;
      lineTax += t;
      push({ group: "refunds", type: "Refund:Product sales", amount: -sub, sku: rl.lineItem ? lineKey(rl.lineItem) : null, txId: r.id, postedAt: at, eventAt: at });
    }
    push({ group: "refunds", type: "Refund:Tax collected", amount: -lineTax, txId: r.id, postedAt: at, eventAt: at });
    push({ group: "taxes", type: "Tax remitted", amount: lineTax, txId: r.id, postedAt: at, eventAt: at });
    push({ group: "refunds", type: "Refund:Shipping & other", amount: -(total - lines - lineTax), txId: r.id, postedAt: at, eventAt: at });
  }

  // A chargeback the merchant lost (or accepted) takes the whole payment back — from the order's
  // dispute status when the ledger (which also knows the fee and the day) isn't available.
  for (const d of ledgerFees ? [] : (o.disputes ?? [])) {
    if (!["LOST", "ACCEPTED"].includes(d.status ?? "")) continue;
    const at = o.updatedAt ? new Date(o.updatedAt) : placedAt;
    push({ group: "refunds", type: "Chargeback", amount: -num(o.currentTotalPriceSet), txId: d.id, postedAt: at, eventAt: at });
  }
  return rows;
}

/** Rewrite these orders' rows from their current state (edits, refunds and disputes included). */
export async function upsertShopifyFinanceEvents(
  nodes: ShopifyFinanceNode[],
  resolve: (line: { sku: string | null; variantId?: string }) => string | null,
  ledgerFees = false,
): Promise<{ rows: number }> {
  const rows = nodes.flatMap((n) => flattenShopifyOrder(n, resolve, ledgerFees));
  const baseCurrency = (await getCurrentOrg())?.currencyCode ?? "USD";
  for (const r of rows) r.baseAmount = r.currency === baseCurrency ? r.amount : round2(r.amount * (await fxRate(r.currency, baseCurrency, r.postedAt)));

  const orderIds = [...new Set(nodes.map((n) => n.id))];
  const orgId = await getCurrentOrgId();
  for (let i = 0; i < orderIds.length; i += 500) {
    const ids = orderIds.slice(i, i + 500);
    const chunk = rows.filter((r) => ids.includes(r.orderId));
    await prisma.$transaction(
      [
        prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance:${orgId ?? ""}`}))`,
        prisma.financeEvent.deleteMany({ where: { channel: "SHOPIFY", orderId: { in: ids } } }),
        ...(chunk.length ? [prisma.financeEvent.createMany({ data: chunk.map((r) => ({ channel: "SHOPIFY", ...r })) })] : []),
      ],
      { timeout: 120_000, maxWait: 15_000 },
    );
  }
  return { rows: rows.length };
}

/* ------------------------- the Shopify Payments balance ledger -------------------------
 * One row per money movement on the merchant's Shopify Payments balance. Charges carry the
 * processing fee; a dispute withdrawal carries the chargeback and its fee; adjustments are
 * Shopify's own credits and debits. Transfers/payouts are cash moving to the bank, not P&L. */

type BalanceTx = {
  id: string;
  type: string; // CHARGE | REFUND | DISPUTE_WITHDRAWAL | DISPUTE_REVERSAL | TRANSFER | *_ADJUSTMENT | …
  sourceType: string; // CHARGE | REFUND | DISPUTE | TRANSFER | ADJUSTMENT | …
  transactionDate: string;
  amount: { amount: string; currencyCode: string };
  fee: { amount: string };
  associatedOrder: { id: string } | null;
  adjustmentReason: string | null;
};

/** "TAX_ADJUSTMENT_DEBIT" → "Tax adjustment debit". */
const label = (type: string) => {
  const t = type.toLowerCase().replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function balanceRows(t: BalanceTx): Row[] {
  const at = new Date(t.transactionDate);
  const amount = num(t.amount.amount);
  const fee = num(t.fee.amount); // positive = charged to the merchant
  const base = {
    orderId: t.associatedOrder?.id ?? "",
    txId: t.id,
    sku: null,
    quantity: null,
    status: "released" as const,
    releasedAt: null,
    currency: t.amount.currencyCode,
    baseAmount: 0,
    postedAt: at,
    eventAt: at,
  };
  const rows: Row[] = [];
  const push = (group: PnlGroup, type: string, value: number) => {
    if (value !== 0) rows.push({ ...base, group, type, amount: round2(value) });
  };
  switch (t.sourceType) {
    case "CHARGE":
      push("payment_fees", "Processing fee", -fee);
      break;
    case "REFUND":
      // The refunded money is already on the order's refund; Shopify keeps the original fee.
      push("payment_fees", "Processing fee", -fee);
      break;
    case "DISPUTE":
      if (/REVERSAL/.test(t.type)) {
        push("refunds", "Chargeback reversed", amount);
        push("payment_fees", "Chargeback fee refunded", -fee);
      } else {
        push("refunds", "Chargeback", amount);
        push("payment_fees", "Chargeback fee", -fee);
      }
      break;
    case "ADJUSTMENT":
      push("other", label(t.type), amount);
      push("payment_fees", "Processing fee", -fee);
      break;
    default:
      // Transfers, payouts, reserves: cash timing, not profit.
      break;
  }
  return rows;
}

/**
 * Pull the balance ledger (all of it, or the last `sinceDays` with a little overlap) and upsert
 * its rows by Shopify's own transaction id. Returns the kinds it skipped, for the log.
 */
export async function importShopifyPaymentsLedger(shop: string, accessToken: string, sinceDays?: number): Promise<{ rows: number; skipped: Record<string, number> }> {
  const since = sinceDays ? new Date(Date.now() - (sinceDays + 2) * 86_400_000).toISOString().slice(0, 10) : null;
  const txs: BalanceTx[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 400; page++) {
    const data: { shopifyPaymentsAccount: { balanceTransactions: { nodes: BalanceTx[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null } =
      await shopifyGraphQL(
        shop,
        accessToken,
        `query($cursor: String, $q: String) {
          shopifyPaymentsAccount {
            balanceTransactions(first: 250, after: $cursor, query: $q, sortKey: PROCESSED_AT) {
              nodes { id type sourceType transactionDate amount { amount currencyCode } fee { amount } associatedOrder { id } adjustmentReason }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
        { cursor, q: since ? `processed_at:>=${since}` : null },
      );
    const page_ = data.shopifyPaymentsAccount?.balanceTransactions;
    if (!page_) break;
    txs.push(...page_.nodes);
    if (!page_.pageInfo.hasNextPage) break;
    cursor = page_.pageInfo.endCursor;
  }

  const skipped: Record<string, number> = {};
  const rows: Row[] = [];
  for (const t of txs) {
    const r = balanceRows(t);
    const cash = ["TRANSFER", "PAYOUT", "RESERVE"].some((k) => t.sourceType.includes(k) || t.type.includes(k));
    if (r.length === 0 && !cash && (num(t.amount.amount) !== 0 || num(t.fee.amount) !== 0)) {
      const k = `${t.type}/${t.sourceType}`;
      skipped[k] = (skipped[k] ?? 0) + 1;
    }
    rows.push(...r);
  }
  const baseCurrency = (await getCurrentOrg())?.currencyCode ?? "USD";
  for (const r of rows) r.baseAmount = r.currency === baseCurrency ? r.amount : round2(r.amount * (await fxRate(r.currency, baseCurrency, r.postedAt)));

  const ids = [...new Set(txs.map((t) => t.id))];
  const orgId = await getCurrentOrgId();
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = new Set(ids.slice(i, i + 1000));
    const data = rows.filter((r) => chunk.has(r.txId));
    await prisma.$transaction(
      [
        prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance:${orgId ?? ""}`}))`,
        prisma.financeEvent.deleteMany({ where: { channel: "SHOPIFY", txId: { in: [...chunk] } } }),
        ...(data.length ? [prisma.financeEvent.createMany({ data: data.map((r) => ({ channel: "SHOPIFY", ...r, orderId: r.orderId || null })) })] : []),
      ],
      { timeout: 120_000, maxWait: 15_000 },
    );
  }
  return { rows: rows.length, skipped };
}
