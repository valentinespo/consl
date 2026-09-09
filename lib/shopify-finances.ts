import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { getCurrentOrg } from "@/lib/org";
import { fxRate } from "@/lib/fx";
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
 * like Amazon's unmapped listings. Fees come from the order's own transactions; the separate
 * dispute FEE lives only in the Shopify Payments balance ledger (scope `read_shopify_payments`,
 * not requested yet).
 */

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

  // What Shopify Payments kept on the capture(s).
  let fees = 0;
  for (const t of o.transactions ?? []) {
    if (t.status !== "SUCCESS" || !["SALE", "CAPTURE"].includes(t.kind)) continue;
    for (const f of t.fees ?? []) fees += num(f.amount.amount);
  }
  push({ group: "payment_fees", type: "Processing fee", amount: -fees });

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

  // A chargeback the merchant lost (or accepted) takes the whole payment back.
  for (const d of o.disputes ?? []) {
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
): Promise<{ rows: number }> {
  const rows = nodes.flatMap((n) => flattenShopifyOrder(n, resolve));
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
