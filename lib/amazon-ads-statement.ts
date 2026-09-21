import "server-only";
import { prisma } from "@/lib/prisma";
import { zonedDayStart } from "@/lib/pnl-periods";
import { HELD_SUFFIX, coveredRangesFor, unifyAdInvoices, waterfillAdInvoices, type AdFillResult, type AdSpendByDay, type DayRanges } from "@/lib/ads-waterfill";
import type { PnlSource } from "@/lib/pnl-shared";

/**
 * Amazon ad spend as the statement books it, for the company in context (see lib/ads-waterfill):
 * every ad invoice exactly once — the charges in Amazon's money report, plus from Amazon's invoice
 * feed whatever was paid some other way — placed day by day along the Ads API's daily spend, plus
 * the spend no invoice has claimed yet. Computed on every read from the raw rows — nothing
 * derived is stored, so it can never disagree with the invoices or the API rows under it.
 *
 * It takes over a company's ad lines once its Amazon Ads connection has data — daily spend
 * (`amazonAdsSince`) or invoices from the feed; before that, and for a company that never
 * connects Amazon Ads, invoices stay where Amazon posted them, exactly as they always were. Ad
 * credits (positive rows) stay as posted — except the refund of a written-off invoice, which
 * leaves together with the charge it cancels.
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

export async function amazonAdsStatementRows(): Promise<{
  active: boolean;
  rows: AdStatementRow[];
  audit: AdFillResult["audit"] | null;
  /** Ledger rows the statement must leave out besides the ad charges themselves: the refund of a written-off invoice, which cancels a charge this fill already dropped. */
  excludeIds: string[];
  /** How the invoices came together: charges given their exact period by the feed, charges the feed doesn't reach, invoices paid outside the balance, and invoices whose detail isn't read yet. */
  invoices: { matched: number; moneyReportOnly: number; fromFeed: number; waitingDetail: number } | null;
}> {
  const off = { active: false, rows: [], audit: null, excludeIds: [], invoices: null };
  if (!AMAZON_ADS_WATERFILL) return off;
  const settings = await prisma.settings.findFirst({ select: { amazonAdsSince: true, amazonAdsSyncedThrough: true, amazonAdsCoverage: true } });
  if (!settings) return off;
  if (!settings.amazonAdsSince && !(await prisma.adInvoice.findFirst({ where: { provider: "amazon_ads" }, select: { id: true } }))) return off;

  const [integration, invoiceRows, spendRows, feedRows, floor] = await Promise.all([
    prisma.integration.findFirst({ where: { provider: "amazon_ads" }, select: { timezone: true } }),
    prisma.financeEvent.findMany({
      where: { channel: "AMAZON", type: "ProductAdsPayment", amount: { not: 0 } },
      select: { id: true, postedAt: true, amount: true, baseAmount: true },
      orderBy: [{ postedAt: "asc" }, { id: "asc" }],
    }),
    prisma.financeEvent.findMany({
      where: { channel: "AMAZON", txId: { startsWith: "ads:" } },
      select: { txId: true, type: true, amount: true, baseAmount: true },
    }),
    prisma.adInvoice.findMany({
      where: { provider: "amazon_ads" },
      select: { externalId: true, status: true, fromDay: true, toDay: true, invoiceDay: true, amount: true, baseAmount: true, balancePaid: true, programs: true, detailAt: true },
    }),
    // The company's first Amazon money: an invoice that ended before it is outside its books.
    prisma.financeEvent.findFirst({ where: { channel: "AMAZON", NOT: { txId: { startsWith: "ads:" } } }, orderBy: { eventAt: "asc" }, select: { eventAt: true } }),
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

  // The days the API's figures are complete for, as ranges: an outage longer than Amazon keeps
  // daily data leaves a hole, and a hole is not "days without spend".
  const syncedDay = settings.amazonAdsSyncedThrough ? settings.amazonAdsSyncedThrough.toISOString().slice(0, 10) : null;
  const lastDay = syncedDay && lastSpendDay ? (syncedDay > lastSpendDay ? syncedDay : lastSpendDay) : (syncedDay ?? lastSpendDay);
  const sinceDay = settings.amazonAdsSince ? dayOf(settings.amazonAdsSince) : null;
  const unbroken: DayRanges = sinceDay && lastDay && sinceDay <= lastDay ? [[sinceDay, lastDay]] : [];
  const covered = settings.amazonAdsSince ? coveredRangesFor(settings.amazonAdsCoverage, usedAdProducts, lastDay, unbroken) : [];

  const unified = unifyAdInvoices({
    ledger: invoiceRows.filter((r) => r.amount < 0).map((r) => ({ id: r.id, day: dayOf(r.postedAt), amount: -(r.baseAmount ?? r.amount) })),
    credits: invoiceRows.filter((r) => r.amount > 0).map((r) => ({ id: r.id, day: dayOf(r.postedAt), amount: r.baseAmount ?? r.amount })),
    feed: feedRows.map((f) => ({
      id: f.externalId,
      from: f.fromDay,
      to: f.toDay,
      invoiceDay: f.invoiceDay,
      amount: f.baseAmount ?? f.amount,
      status: f.status,
      detail: !!f.detailAt,
      balancePaid: f.balancePaid ?? 0,
      mix: f.programs && typeof f.programs === "object" && !Array.isArray(f.programs) ? (f.programs as Record<string, number>) : null,
    })),
    floorDay: floor ? dayOf(floor.eventAt) : null,
  });
  const fill = waterfillAdInvoices({ invoices: unified.invoices, spend, covered });
  // The one thing this must never get wrong: what it books is the invoices, to the cent.
  const cents = (n: number) => Math.round(n * 100);
  const owed = unified.invoices.reduce((t, x) => t + cents(x.amount), 0);
  const booked = fill.rows.filter((r) => !r.held).reduce((t, r) => t + cents(r.amount), 0);
  if (owed !== booked) console.error(`[amazon-ads] INVARIANT BROKEN: invoices ${owed / 100} vs booked ${booked / 100}`);

  // An account Amazon bills by card never shows an ad invoice in its money report: its API spend
  // is simply its ad spend, and "not invoiced yet" would be a promise that never comes true.
  const billedHere = unified.invoices.length > 0;
  const rows: AdStatementRow[] = fill.rows.map((r) => ({
    at: zonedDayStart(r.day, tz).getTime() + 12 * 3_600_000,
    type: billedHere || !r.held ? r.type : r.type.slice(0, -HELD_SUFFIX.length),
    amount: -r.amount,
    // The amount is the invoice's (Amazon's money report); the day and ad type are Amazon Ads'.
    sources: r.held ? ["AMAZON_ADS"] : r.shaped ? ["AMAZON", "AMAZON_ADS"] : ["AMAZON"],
  }));
  return { active: true, rows, audit: fill.audit, excludeIds: unified.cancelledCreditIds, invoices: { matched: unified.matched, moneyReportOnly: unified.fromLedgerOnly, fromFeed: unified.fromFeed, waitingDetail: unified.waitingDetail } };
}
