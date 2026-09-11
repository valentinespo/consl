import "server-only";
import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { getCurrentOrgId } from "@/lib/tenant";
import { getCurrentOrg } from "@/lib/org";
import { getOrgSettings, saveOrgSettings } from "@/lib/settings";
import { fxRate } from "@/lib/fx";
import { metaClient, metaGraph } from "@/lib/meta-ads";
import { zonedDayStart } from "@/lib/pnl";

/**
 * Daily Meta ad spend → one ledger row per day under the P&L's Advertising bucket, on the channel
 * the connection counts against. The Insights API answers synchronously, a day per row; the
 * first pull reaches back two years (as far as the sales history goes), later passes re-read the
 * last few days because Meta finalises spend late. The row's day is the ad account's own
 * calendar (Meta reports in the account's timezone).
 */

const BACKFILL_DAYS = 730;
const OVERLAP_DAYS = 3;
const CHUNK_DAYS = 90;

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => day(new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000));
const todayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

type Insight = { date_start: string; spend?: string; account_currency?: string };

export async function importMetaAdsSpend(): Promise<{ rows: number; from: string; to: string } | null> {
  const client = await metaClient();
  if (!client) return null;
  const s = await getOrgSettings();
  const today = todayIn(client.timezone);
  const synced = s.metaAdsSyncedThrough ? day(s.metaAdsSyncedThrough) : null;
  const from = synced ? addDays(synced, -OVERLAP_DAYS) : addDays(today, -BACKFILL_DAYS);
  const to = today;
  const baseCurrency = (await getCurrentOrg())?.currencyCode ?? "USD";
  const orgId = await getCurrentOrgId();
  let rows = 0;
  let currency = "USD";

  for (let start = from; start <= to; start = addDays(start, CHUNK_DAYS)) {
    const end = addDays(start, CHUNK_DAYS - 1) < to ? addDays(start, CHUNK_DAYS - 1) : to;
    const data: Insight[] = [];
    let next: string | null = null;
    for (let page = 0; page < 20; page++) {
      const j: { data?: Insight[]; paging?: { next?: string } } = next
        ? await (await fetch(next)).json()
        : await metaGraph(`/${client.account}/insights`, {
            access_token: client.token,
            level: "account",
            fields: "spend,account_currency",
            time_increment: "1",
            time_range: JSON.stringify({ since: start, until: end }),
            limit: "500",
          });
      data.push(...(j.data ?? []));
      next = j.paging?.next ?? null;
      if (!next) break;
    }
    // Every day of the chunk is rewritten — a day with no spend loses its row.
    const days: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
    const created: Array<{ channel: string; postedAt: Date; eventAt: Date; group: string; type: string; amount: number; currency: string; baseAmount: number; txId: string; status: string }> = [];
    for (const r of data) {
      const spend = Number(r.spend) || 0;
      if (!r.date_start || spend === 0) continue;
      currency = r.account_currency ?? currency;
      const at = zonedDayStart(r.date_start, client.timezone);
      const amount = -Math.round(spend * 100) / 100;
      const fx = currency === baseCurrency ? 1 : await fxRate(currency, baseCurrency, at);
      created.push({ channel: client.channel, postedAt: at, eventAt: at, group: "advertising", type: "Meta ads", amount, currency, baseAmount: Math.round(amount * fx * 100) / 100, txId: `meta:${client.account}:${r.date_start}`, status: "released" });
    }
    await prisma.$transaction([
      prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance:${orgId ?? ""}`}))`,
      prisma.financeEvent.deleteMany({ where: { txId: { in: days.map((d) => `meta:${client.account}:${d}`) } } }),
      ...(created.length ? [prisma.financeEvent.createMany({ data: created })] : []),
    ]);
    rows += created.length;
  }

  await saveOrgSettings({
    metaAdsSyncedThrough: new Date(`${to}T00:00:00Z`),
    ...(s.metaAdsSince ? {} : { metaAdsSince: zonedDayStart(from, client.timezone) }),
  });
  await prismaBase.integration.update({ where: { id: client.integrationId }, data: { lastSyncAt: new Date(), lastError: null } });
  return { rows, from, to };
}
