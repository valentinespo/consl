import "server-only";
import { prisma } from "@/lib/prisma";
import { zonedDayStart } from "@/lib/pnl-periods";
import { HELD_SUFFIX, coveredFromFor, waterfillAdInvoices, type AdFillResult, type AdSpendByDay } from "@/lib/ads-waterfill";
import type { PnlSource } from "@/lib/pnl-shared";

/**
 * Amazon ad spend as the statement books it, for the company in context (see lib/ads-waterfill):
 * the ad invoices from Amazon's money report, placed day by day along the Ads API's daily spend,
 * plus the spend no invoice has claimed yet. Computed on every read from the raw ledger rows —
 * nothing derived is stored, so it can never disagree with the invoices or the API rows under it.
 *
 * It takes over a company's ad lines once its Amazon Ads import has data (`amazonAdsSince`);
 * before that — and for a company that never connects Amazon Ads — invoices stay where Amazon
 * posted them, exactly as they always were. Ad credits (positive rows) always stay as posted.
 */
export const AMAZON_ADS_WATERFILL = true;

export type AdStatementRow = {
  /** Noon of the ads account's day: lands on the same calendar day in any company timezone. */
  at: number;
  type: string;
  /** Negative, like every cost on the statement. */
  amount: number;
  sources: PnlSource[];
};

const DEFAULT_ADS_TZ = "America/Los_Angeles";

function dayIn(tz: string): (at: Date) => string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return (at) => f.format(at);
}

export async function amazonAdsStatementRows(): Promise<{ active: boolean; rows: AdStatementRow[]; audit: AdFillResult["audit"] | null }> {
  const off = { active: false, rows: [], audit: null };
  if (!AMAZON_ADS_WATERFILL) return off;
  const settings = await prisma.settings.findFirst({ select: { amazonAdsSince: true, amazonAdsSyncedThrough: true, amazonAdsCoverage: true } });
  if (!settings?.amazonAdsSince) return off;

  const [integration, invoiceRows, spendRows] = await Promise.all([
    prisma.integration.findFirst({ where: { provider: "amazon_ads" }, select: { timezone: true } }),
    prisma.financeEvent.findMany({
      where: { channel: "AMAZON", type: "ProductAdsPayment", amount: { lt: 0 } },
      select: { id: true, postedAt: true, amount: true, baseAmount: true },
      orderBy: [{ postedAt: "asc" }, { id: "asc" }],
    }),
    prisma.financeEvent.findMany({
      where: { channel: "AMAZON", txId: { startsWith: "ads:" } },
      select: { txId: true, type: true, amount: true, baseAmount: true },
    }),
  ]);
  const tz = integration?.timezone || DEFAULT_ADS_TZ;
  const dayOf = dayIn(tz);

  const spend: AdSpendByDay = new Map();
  const usedAdProducts = new Set<string>();
  let lastSpendDay: string | null = null;
  for (const r of spendRows) {
    const [, adProduct = "", day = ""] = (r.txId ?? "").split(":");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const cost = -(r.baseAmount ?? r.amount);
    if (!(cost > 0)) continue;
    usedAdProducts.add(adProduct);
    const types = spend.get(day) ?? new Map<string, number>();
    types.set(r.type, (types.get(r.type) ?? 0) + cost);
    spend.set(day, types);
    if (!lastSpendDay || day > lastSpendDay) lastSpendDay = day;
  }

  const coveredFrom = coveredFromFor(settings.amazonAdsCoverage, usedAdProducts, dayOf(settings.amazonAdsSince));
  const syncedDay = settings.amazonAdsSyncedThrough ? settings.amazonAdsSyncedThrough.toISOString().slice(0, 10) : null;
  const coveredTo = syncedDay && lastSpendDay ? (syncedDay > lastSpendDay ? syncedDay : lastSpendDay) : (syncedDay ?? lastSpendDay);

  const fill = waterfillAdInvoices({
    invoices: invoiceRows.map((r) => ({ id: r.id, day: dayOf(r.postedAt), amount: -(r.baseAmount ?? r.amount) })),
    spend,
    coveredFrom,
    coveredTo,
  });

  // An account Amazon bills by card never shows an ad invoice in its money report: its API spend
  // is simply its ad spend, and "not invoiced yet" would be a promise that never comes true.
  const billedHere = invoiceRows.length > 0;
  const rows: AdStatementRow[] = fill.rows.map((r) => ({
    at: zonedDayStart(r.day, tz).getTime() + 12 * 3_600_000,
    type: billedHere || !r.held ? r.type : r.type.slice(0, -HELD_SUFFIX.length),
    amount: -r.amount,
    // The amount is the invoice's (Amazon's money report); the day and ad type are Amazon Ads'.
    sources: r.held ? ["AMAZON_ADS"] : r.shaped ? ["AMAZON", "AMAZON_ADS"] : ["AMAZON"],
  }));
  return { active: true, rows, audit: fill.audit };
}
