import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { getCurrentOrg } from "@/lib/org";
import { fxRate } from "@/lib/fx";
import type { PnlGroup } from "@/lib/finances";

/**
 * TikTok Shop's settlement ledger → FinanceEvent rows, so a TikTok sale adds up the same way an
 * Amazon one does: one signed row per money line, tagged with its P&L bucket.
 *
 * TikTok settles per order. Each order gets one statement transaction carrying the money split
 * — gross sales, seller discount, customer-paid shipping, referral fee, affiliate commission,
 * promotion fees, refunds — plus the per-SKU quantities and revenue. That transaction id is the
 * upsert key, so any order can be re-read freely. Order-level lines are shared out across the
 * order's SKUs by revenue, so every row carries a SKU; the "Gross sales" row also carries the
 * units (TikTok's counterpart of Amazon's Principal row — the unit driver for COGS), left off when
 * the order was refunded in full. A transaction is "held" until its statement is paid out (TikTok
 * pays about a week after delivery), and the money lands in the P&L on the order's purchase
 * instant like Amazon's shipment rows, refunds on the day they were settled.
 *
 * The line names are TikTok's own (the Finance API reports the same money as named amounts —
 * gross_sales_amount, seller_discount_amount, customer_paid_shipping_fee_amount, referral fee,
 * affiliate commission, … — which map onto these labels one for one).
 */

export type TikTokStatementLine = { type?: string | null; name?: string | null; amount: string };

export type TikTokStatementTransaction = {
  /** TikTok's statement transaction id — the upsert key. */
  id: string;
  order_id: string;
  statement_id?: string | null;
  order_create_time: number; // ms
  statement_time?: number | null; // ms — the statement's cut date
  settlement_time?: number | null; // ms — when the statement was paid out
  estimated_settlement_time?: number | null; // ms — TikTok's due date while unpaid
  status: "PAID" | "TO_SETTLE";
  currency: string;
  revenue_breakdown: TikTokStatementLine[];
  fee_breakdown: TikTokStatementLine[];
  shipping_breakdown: TikTokStatementLine[];
  sku_statement_transactions: { sku_id: string; seller_sku?: string | null; quantity: number; revenue_amount: string }[];
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
  status: "held" | "released";
  releasedAt: Date | null;
  currency: string;
  baseAmount: number;
};

const num = (v: string | number | null | undefined): number => {
  const n = typeof v === "number" ? v : parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** P&L bucket + label for one settlement line. */
function bucket(section: "revenue" | "fee" | "shipping", line: TikTokStatementLine): { group: PnlGroup; type: string } {
  const name = (line.name ?? line.type ?? "").trim() || "Other";
  if (/refund/i.test(name) || /refund/i.test(line.type ?? "")) return { group: "refunds", type: `Refund:${name.replace(/\s*refund\s*$/i, "")}` };
  if (section !== "fee") return { group: "sales", type: name };
  if (/referral|commission fee|platform commission/i.test(name) && !/affiliate/i.test(name)) return { group: "referral_fees", type: name };
  if (/promotion|\bads?\b|advertis/i.test(name)) return { group: "advertising", type: name };
  return { group: "other", type: name };
}

/** One transaction → its rows (no currency conversion yet). */
export function flattenTikTokStatement(tx: TikTokStatementTransaction): Row[] {
  const orderedAt = new Date(tx.order_create_time);
  const settledAt = tx.settlement_time ? new Date(tx.settlement_time) : null;
  const statementAt = tx.statement_time ? new Date(tx.statement_time) : settledAt;
  const released = tx.status === "PAID";
  const releasedAt = settledAt ?? (tx.estimated_settlement_time ? new Date(tx.estimated_settlement_time) : null);

  // Each SKU's share of the order's money: by revenue, else by units, else evenly.
  const skus = tx.sku_statement_transactions ?? [];
  const revenue = skus.map((s) => Math.abs(num(s.revenue_amount)));
  const units = skus.map((s) => Math.max(0, s.quantity));
  const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const shares =
    skus.length <= 1
      ? skus.map(() => 1)
      : total(revenue) > 0
        ? revenue.map((r) => r / total(revenue))
        : total(units) > 0
          ? units.map((u) => u / total(units))
          : skus.map(() => 1 / skus.length);

  const rows: Row[] = [];
  const push = (section: "revenue" | "fee" | "shipping", line: TikTokStatementLine) => {
    const amount = num(line.amount);
    if (amount === 0) return;
    const { group, type } = bucket(section, line);
    const base = {
      postedAt: orderedAt,
      eventAt: group === "refunds" ? (statementAt ?? orderedAt) : orderedAt,
      group,
      type,
      orderId: tx.order_id,
      txId: tx.id,
      status: (released ? "released" : "held") as "held" | "released",
      releasedAt,
      currency: tx.currency,
      baseAmount: 0,
    };
    if (skus.length === 0) {
      rows.push({ ...base, amount, sku: null, quantity: null });
      return;
    }
    // Share the line out by SKU; the last SKU takes the rounding remainder so the parts add up.
    let left = amount;
    skus.forEach((s, i) => {
      const part = i === skus.length - 1 ? round2(left) : round2(amount * shares[i]);
      left = round2(left - part);
      const unitDriver = group === "sales" && /gross sales/i.test(type) && num(s.revenue_amount) > 0;
      rows.push({ ...base, amount: part, sku: s.seller_sku?.trim() || s.sku_id, quantity: unitDriver ? s.quantity : null });
    });
  };
  for (const l of tx.revenue_breakdown ?? []) push("revenue", l);
  for (const l of tx.shipping_breakdown ?? []) push("shipping", l);
  for (const l of tx.fee_breakdown ?? []) push("fee", l);
  return rows;
}

/** Write these transactions' rows, replacing whatever was held for the same transaction ids. */
export async function upsertTikTokFinanceEvents(txs: TikTokStatementTransaction[]): Promise<{ rows: number }> {
  const rows = txs.flatMap(flattenTikTokStatement);
  const baseCurrency = (await getCurrentOrg())?.currencyCode ?? "USD";
  for (const r of rows) r.baseAmount = r.currency === baseCurrency ? r.amount : round2(r.amount * (await fxRate(r.currency, baseCurrency, r.postedAt)));

  const keys = [...new Set(txs.map((t) => t.id))];
  const orgId = await getCurrentOrgId();
  await prisma.$transaction(
    [
      prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance:${orgId ?? ""}`}))`,
      ...(keys.length ? [prisma.financeEvent.deleteMany({ where: { channel: "TIKTOK", txId: { in: keys } } })] : []),
      ...(rows.length ? [prisma.financeEvent.createMany({ data: rows.map((r) => ({ channel: "TIKTOK", ...r })) })] : []),
    ],
    { timeout: 120_000, maxWait: 15_000 },
  );
  return { rows: rows.length };
}
