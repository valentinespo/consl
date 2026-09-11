import "server-only";
import { gunzipSync } from "node:zlib";
import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { getCurrentOrgId } from "@/lib/tenant";
import { getCurrentOrg } from "@/lib/org";
import { getOrgSettings, saveOrgSettings } from "@/lib/settings";
import { fxRate } from "@/lib/fx";
import { adsClient } from "@/lib/amazon-ads";
import { zonedDayStart } from "@/lib/pnl";

/**
 * Daily Amazon ad spend → the P&L's Advertising bucket, one ledger row per day per ad type
 * (Sponsored Products / Brands / Display), from the Ads API's campaign reports.
 *
 * Amazon builds reports asynchronously: a request returns an id, the file is ready minutes (at
 * most hours) later. So the import is two steps run by the scheduler: REQUEST the reports for
 * the days not yet covered (31 days per request is Amazon's limit; the first pull reaches back
 * as far as each ad type keeps data — 95/60/65 days), and COLLECT whatever finished, writing
 * its rows and moving the marker. Days near the marker are re-read on every pass because Amazon
 * keeps revising the last few days.
 *
 * The row's day is Amazon's: the report is cut in the advertising profile's own timezone, so a
 * day's spend is booked at the start of that calendar day in that zone. Spend is negative, like
 * every cost row. From the first day this import covers, the P&L drops the ad INVOICE payments in
 * Amazon's money report (`ProductAdsPayment`) — same money, now day by day instead of by bill.
 */

type AdProduct = "SPONSORED_PRODUCTS" | "SPONSORED_BRANDS" | "SPONSORED_DISPLAY";
const AD_PRODUCTS: { adProduct: AdProduct; reportTypeId: string; label: string; retentionDays: number; columns: string[] }[] = [
  { adProduct: "SPONSORED_PRODUCTS", reportTypeId: "spCampaigns", label: "Sponsored Products", retentionDays: 93, columns: ["date", "campaignId", "campaignName", "cost", "impressions", "clicks", "purchases14d", "sales14d"] },
  { adProduct: "SPONSORED_BRANDS", reportTypeId: "sbCampaigns", label: "Sponsored Brands", retentionDays: 58, columns: ["date", "campaignId", "campaignName", "cost", "impressions", "clicks", "purchases", "sales"] },
  { adProduct: "SPONSORED_DISPLAY", reportTypeId: "sdCampaigns", label: "Sponsored Display", retentionDays: 63, columns: ["date", "campaignId", "campaignName", "cost", "impressions", "clicks", "purchases", "sales"] },
];
const WINDOW_DAYS = 31;
const OVERLAP_DAYS = 3;

type Pending = { id: string; adProduct: AdProduct; from: string; to: string };
const REPORT_CT = "application/vnd.createasyncreportrequest.v3+json";

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => day(new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000));

/** Today in the profile's zone (the last day Amazon can report on is yesterday, usually). */
function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function pendingOf(raw: unknown): Pending[] {
  return Array.isArray(raw) ? (raw as Pending[]).filter((p) => p && typeof p.id === "string") : [];
}

/** Ask Amazon for the reports covering every day not yet on record (or being re-read). */
export async function requestAmazonAdsReports(): Promise<{ requested: number }> {
  const client = await adsClient();
  if (!client) return { requested: 0 };
  const s = await getOrgSettings();
  const pending = pendingOf(s.amazonAdsPendingReports);
  if (pending.length) return { requested: 0 }; // finish what's in flight first
  const tz = client.timezone ?? "America/Los_Angeles";
  const today = todayIn(tz);
  const synced = s.amazonAdsSyncedThrough ? day(s.amazonAdsSyncedThrough) : null;
  const requested: Pending[] = [];
  for (const p of AD_PRODUCTS) {
    // From the marker (minus overlap) — or as far back as this ad type keeps — up to today.
    const floor = addDays(today, -p.retentionDays);
    let from = synced ? addDays(synced, -OVERLAP_DAYS) : floor;
    if (from < floor) from = floor;
    if (from > today) continue;
    while (from <= today) {
      const to = addDays(from, WINDOW_DAYS - 1) < today ? addDays(from, WINDOW_DAYS - 1) : today;
      const r = await fetch(`${client.host}/reporting/reports`, {
        method: "POST",
        headers: { ...client.headers, "Content-Type": REPORT_CT, Accept: REPORT_CT },
        body: JSON.stringify({
          name: `consl ${p.label} ${from}..${to}`,
          startDate: from,
          endDate: to,
          configuration: { adProduct: p.adProduct, groupBy: ["campaign"], columns: p.columns, reportTypeId: p.reportTypeId, timeUnit: "DAILY", format: "GZIP_JSON" },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 425) {
        // An identical request is already generating — Amazon refuses a duplicate; try next tick.
        break;
      }
      if (!r.ok || !j.reportId) {
        // An ad type the account doesn't use (or can't report on yet) is skipped, not fatal.
        console.warn(`[amazon-ads] ${p.label} ${from}..${to}: ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
        break;
      }
      requested.push({ id: j.reportId, adProduct: p.adProduct, from, to });
      from = addDays(to, 1);
    }
  }
  if (requested.length) await saveOrgSettings({ amazonAdsPendingReports: requested });
  return { requested: requested.length };
}

type ReportRow = { date?: string; cost?: number | string; campaignId?: number | string; campaignName?: string };

/** Collect finished reports: write their rows, move the marker when every report of a pass is in. */
export async function collectAmazonAdsReports(): Promise<{ collected: number; rows: number; waiting: number }> {
  const client = await adsClient();
  if (!client) return { collected: 0, rows: 0, waiting: 0 };
  const s = await getOrgSettings();
  const pending = pendingOf(s.amazonAdsPendingReports);
  if (pending.length === 0) return { collected: 0, rows: 0, waiting: 0 };
  const tz = client.timezone ?? "America/Los_Angeles";
  const baseCurrency = (await getCurrentOrg())?.currencyCode ?? "USD";
  const orgId = await getCurrentOrgId();
  const still: Pending[] = [];
  let collected = 0;
  let rows = 0;
  let newestDay: string | null = s.amazonAdsSyncedThrough ? day(s.amazonAdsSyncedThrough) : null;
  let oldestDay: string | null = s.amazonAdsSince ? day(s.amazonAdsSince) : null;

  for (const p of pending) {
    const r = await fetch(`${client.host}/reporting/reports/${p.id}`, { headers: { ...client.headers, "Content-Type": REPORT_CT, Accept: REPORT_CT } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 429) {
      still.push(p);
      continue;
    }
    if (!r.ok) {
      console.warn(`[amazon-ads] report ${p.id}: ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
      continue; // dropped; the next request pass covers the days again
    }
    if (j.status === "FAILED") {
      console.warn(`[amazon-ads] report ${p.id} failed: ${j.failureReason ?? "?"}`);
      continue;
    }
    if (j.status !== "COMPLETED" || !j.url) {
      still.push(p);
      continue;
    }
    const file = await fetch(j.url);
    const buf = Buffer.from(await file.arrayBuffer());
    let data: ReportRow[] = [];
    try {
      data = JSON.parse(gunzipSync(buf).toString("utf8")) as ReportRow[];
    } catch {
      try {
        data = JSON.parse(buf.toString("utf8")) as ReportRow[];
      } catch {
        console.warn(`[amazon-ads] report ${p.id}: unreadable file`);
        continue;
      }
    }
    const label = AD_PRODUCTS.find((a) => a.adProduct === p.adProduct)?.label ?? p.adProduct;
    // One row per day per ad type: the campaigns' spend summed, campaign detail kept off the ledger.
    const byDay = new Map<string, number>();
    for (const row of data) {
      const d = (row.date ?? "").slice(0, 10);
      const cost = Number(row.cost) || 0;
      if (!d) continue;
      byDay.set(d, (byDay.get(d) ?? 0) + cost);
    }
    // Every day of the window is rewritten — a day with no spend loses its row, as it should.
    const days: string[] = [];
    for (let d = p.from; d <= p.to; d = addDays(d, 1)) days.push(d);
    const txIds = days.map((d) => `ads:${p.adProduct}:${d}`);
    const currency = "USD"; // the profile's currency — US marketplace profiles report in USD
    const created: Array<{ channel: string; postedAt: Date; eventAt: Date; group: string; type: string; amount: number; currency: string; baseAmount: number; txId: string; status: string }> = [];
    for (const [d, cost] of byDay) {
      if (cost === 0) continue;
      const at = zonedDayStart(d, tz);
      const amount = -Math.round(cost * 100) / 100;
      const fx = currency === baseCurrency ? 1 : await fxRate(currency, baseCurrency, at);
      created.push({ channel: "AMAZON", postedAt: at, eventAt: at, group: "advertising", type: label, amount, currency, baseAmount: Math.round(amount * fx * 100) / 100, txId: `ads:${p.adProduct}:${d}`, status: "released" });
    }
    await prisma.$transaction([
      prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance:${orgId ?? ""}`}))`,
      prisma.financeEvent.deleteMany({ where: { channel: "AMAZON", txId: { in: txIds } } }),
      ...(created.length ? [prisma.financeEvent.createMany({ data: created })] : []),
    ]);
    rows += created.length;
    collected++;
    if (!newestDay || p.to > newestDay) newestDay = p.to;
    if (!oldestDay || p.from < oldestDay) oldestDay = p.from;
  }

  const update: Record<string, unknown> = { amazonAdsPendingReports: still.length ? still : null };
  // The marker moves only once a pass is fully in, so a window still generating is never skipped.
  if (still.length === 0 && newestDay) update.amazonAdsSyncedThrough = new Date(`${newestDay}T00:00:00Z`);
  if (oldestDay && !s.amazonAdsSince) update.amazonAdsSince = zonedDayStart(oldestDay, tz);
  await saveOrgSettings(update);
  if (collected) await prismaBase.integration.update({ where: { id: client.integrationId }, data: { lastSyncAt: new Date(), lastError: null } });
  return { collected, rows, waiting: still.length };
}

/** One scheduler pass: finish what's generating, then ask for the days not yet covered. */
export async function amazonAdsTick(): Promise<{ collected: number; rows: number; waiting: number; requested: number }> {
  const c = await collectAmazonAdsReports();
  const s = await getOrgSettings();
  const client = await adsClient();
  let requested = 0;
  if (client && c.waiting === 0) {
    const tz = client.timezone ?? "America/Los_Angeles";
    const synced = s.amazonAdsSyncedThrough ? day(s.amazonAdsSyncedThrough) : null;
    // Nothing to ask for while yesterday is already on record and the last pass was recent.
    const upToDate = synced && synced >= addDays(todayIn(tz), -1) && c.collected === 0;
    const lastSync = (await prisma.integration.findFirst({ where: { provider: "amazon_ads" }, select: { lastSyncAt: true } }))?.lastSyncAt;
    const fresh = lastSync && Date.now() - lastSync.getTime() < 6 * 60 * 60_000;
    if (!(upToDate && fresh)) requested = (await requestAmazonAdsReports()).requested;
  }
  return { ...c, requested };
}
