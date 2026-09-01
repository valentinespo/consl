import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { GROUP_ORDER, type Pnl, type PnlGroupBlock } from "@/lib/pnl-shared";

export { GROUP_ORDER, GROUP_LABEL, type Pnl, type PnlGroupBlock, type PnlTypeRow } from "@/lib/pnl-shared";

/** UTC instant of local midnight starting `day` (YYYY-MM-DD) in `tz`, DST-safe. */
export function zonedDayStart(day: string, tz: string): Date {
  const guess = new Date(`${day}T00:00:00Z`);
  const offsetAt = (at: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(at);
    const m = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour % 24, +m.minute, +m.second) - at.getTime();
  };
  const first = new Date(guess.getTime() - offsetAt(guess));
  return new Date(guess.getTime() - offsetAt(first)); // second pass settles DST edges
}

/** Inclusive [from-day, to-day] as UTC instants in `tz`. */
export function zonedDayBounds(fromDay: string, toDay: string, tz: string): { from: Date; to: Date } {
  const next = new Date(`${toDay}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { from: zonedDayStart(fromDay, tz), to: new Date(zonedDayStart(next.toISOString().slice(0, 10), tz).getTime() - 1) };
}

/**
 * The P&L read side: sum the imported financial ledger by bucket for a date window, and price the
 * shipped units with the engine's landed cost.
 *
 * COGS basis: every shipment "Principal" row carries its shipped quantity; each unit is priced at
 * the SKU's weighted-average landed cost across all production (lot lines' FIFO-derived cogPerUnit)
 * plus day-zero opening layers. That is the engine's own number — not a hand-typed unit cost.
 */

/** Weighted-average landed cost per Amazon seller SKU, from lot lines + opening layers. */
async function avgCostBySellerSku(): Promise<Map<string, number>> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return new Map();
  const lot = await prisma.$queryRaw<{ productId: string; cost: number; units: number }[]>`
    SELECT "productId", SUM(units * COALESCE("cogPerUnit", 0)) AS cost, SUM(units) AS units
    FROM "LotLine" WHERE "orgId" = ${orgId} GROUP BY "productId"`;
  const open = await prisma.$queryRaw<{ productId: string; cost: number; units: number }[]>`
    SELECT "productId", SUM(quantity * COALESCE("unitCost", 0)) AS cost, SUM(quantity) AS units
    FROM "StockMovement"
    WHERE "orgId" = ${orgId} AND kind = 'OPENING' AND "itemType" = 'FINISHED' AND "productId" IS NOT NULL
    GROUP BY "productId"`;
  const byProduct = new Map<string, { cost: number; units: number }>();
  for (const r of [...lot, ...open]) {
    const cur = byProduct.get(r.productId) ?? { cost: 0, units: 0 };
    byProduct.set(r.productId, { cost: cur.cost + Number(r.cost), units: cur.units + Number(r.units) });
  }
  const products = await prisma.product.findMany({ select: { id: true, sellerSku: true } });
  const out = new Map<string, number>();
  for (const p of products) {
    const agg = byProduct.get(p.id);
    if (p.sellerSku && agg && agg.units > 0) out.set(p.sellerSku, agg.cost / agg.units);
  }
  return out;
}

export async function getPnl(from: Date, to: Date): Promise<Pnl> {
  const where = { channel: "AMAZON", eventAt: { gte: from, lte: to } };

  const sums = await prisma.financeEvent.groupBy({
    by: ["group", "type"],
    where,
    _sum: { amount: true },
  });

  const groups: PnlGroupBlock[] = GROUP_ORDER.map((g) => {
    const types = sums
      .filter((s) => s.group === g)
      .map((s) => ({ type: s.type, amount: s._sum.amount ?? 0 }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return { group: g, total: types.reduce((t, r) => t + r.amount, 0), types };
  }).filter((b) => b.types.length > 0);

  // COGS: shipped units per SKU in the window × the SKU's weighted-average landed cost.
  const qty = await prisma.financeEvent.groupBy({
    by: ["sku"],
    where: { ...where, group: "sales", type: "Principal", quantity: { not: null } },
    _sum: { quantity: true },
  });
  const costs = await avgCostBySellerSku();
  let cogs = 0;
  let unitsSold = 0;
  const unmatched: string[] = [];
  for (const q of qty) {
    const units = q._sum.quantity ?? 0;
    unitsSold += units;
    const c = q.sku ? costs.get(q.sku) : undefined;
    if (c != null) cogs -= units * c;
    else if (q.sku && units > 0) unmatched.push(q.sku);
  }

  const sales = groups.find((g) => g.group === "sales")?.total ?? 0;
  const ledgerTotal = groups.reduce((t, g) => t + g.total, 0);
  const netProfit = ledgerTotal + cogs;

  const settings = await prisma.settings.findFirst({ select: { financeBackfillCursor: true } });
  const floor = new Date(Date.now() - 725 * 86_400_000);
  const backfillInProgress = !settings?.financeBackfillCursor || new Date(settings.financeBackfillCursor) > floor;

  return {
    groups,
    sales,
    cogs,
    unitsSold,
    netProfit,
    margin: sales !== 0 ? netProfit / sales : null,
    roi: cogs !== 0 ? netProfit / Math.abs(cogs) : null,
    unmatchedSkus: unmatched,
    backfillInProgress,
    hasData: groups.length > 0,
  };
}

/** Oldest posted event — the date picker's lower bound. */
export async function oldestFinanceDate(): Promise<string | null> {
  const first = await prisma.financeEvent.findFirst({ where: { channel: "AMAZON" }, orderBy: { eventAt: "asc" }, select: { eventAt: true } });
  return first ? first.eventAt.toISOString().slice(0, 10) : null;
}
