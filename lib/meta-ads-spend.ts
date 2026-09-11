import "server-only";
import { prisma } from "@/lib/prisma";
import { prismaBase } from "@/lib/prisma-base";
import { getCurrentOrgId } from "@/lib/tenant";
import { getCurrentOrg } from "@/lib/org";
import { getOrgSettings, saveOrgSettings } from "@/lib/settings";
import { fxRate } from "@/lib/fx";
import { metaHub, metaGraph, getMetaAccessToken, getMetaAccountToken, describeAdAccount, isMetaAuthError } from "@/lib/meta-ads";
import { zonedDayStart } from "@/lib/pnl";

/**
 * Daily Meta ad spend → one ledger row per ad account per day under the P&L's Advertising bucket,
 * on the channel the connection counts against. Every linked ad account is read on its own, with
 * its own token, calendar and marker: the Insights API answers synchronously, a day per row; the
 * first pull reaches back two years (as far as the sales history goes), later passes re-read the
 * last few days because Meta finalises spend late.
 */

const BACKFILL_DAYS = 730;
const OVERLAP_DAYS = 3;
const CHUNK_DAYS = 90;

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => day(new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000));
const todayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

type Insight = { date_start: string; spend?: string; account_currency?: string };
type Hub = NonNullable<Awaited<ReturnType<typeof metaHub>>>;
type Account = Awaited<ReturnType<typeof prisma.metaAdAccount.findMany>>[number];

/** A connection made before per-account rows existed: adopt its single account, markers included. */
async function adoptLegacyAccount(hub: Hub): Promise<Account | null> {
  if (!hub.accessTokenEnc || !hub.sellerId) return null;
  const token = await getMetaAccessToken(hub);
  const info = await describeAdAccount(token, hub.sellerId).catch(() => null);
  const s = await getOrgSettings();
  return prisma.metaAdAccount.create({
    data: {
      accountId: hub.sellerId,
      accountNumber: info?.account_id ?? hub.marketplaceId,
      name: info?.name ?? hub.sellerId,
      currency: info?.currency ?? null,
      timezone: info?.timezone_name ?? hub.timezone,
      businessId: info?.business?.id ?? null,
      businessName: info?.business?.name ?? null,
      accessTokenEnc: hub.accessTokenEnc,
      accessTokenExpiresAt: hub.accessTokenExpiresAt,
      status: "connected",
      connectedAt: hub.connectedAt ?? new Date(),
      syncedThrough: s.metaAdsSyncedThrough,
      since: s.metaAdsSince,
    },
  });
}

async function readAccount(hub: Hub, a: Account, orgId: string, baseCurrency: string): Promise<{ rows: number; since: Date; through: string }> {
  const token = await getMetaAccountToken(a);
  const tz = a.timezone ?? hub.timezone ?? "America/Los_Angeles";
  const today = todayIn(tz);
  const synced = a.syncedThrough ? day(a.syncedThrough) : null;
  const from = synced ? addDays(synced, -OVERLAP_DAYS) : addDays(today, -BACKFILL_DAYS);
  const to = today;
  let rows = 0;
  let currency = a.currency ?? "USD";

  for (let start = from; start <= to; start = addDays(start, CHUNK_DAYS)) {
    const end = addDays(start, CHUNK_DAYS - 1) < to ? addDays(start, CHUNK_DAYS - 1) : to;
    const data: Insight[] = [];
    let next: string | null = null;
    for (let page = 0; page < 20; page++) {
      const j: { data?: Insight[]; paging?: { next?: string } } = next
        ? await (await fetch(next)).json()
        : await metaGraph(`/${a.accountId}/insights`, {
            access_token: token,
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
      const at = zonedDayStart(r.date_start, tz);
      const amount = -Math.round(spend * 100) / 100;
      const fx = currency === baseCurrency ? 1 : await fxRate(currency, baseCurrency, at);
      created.push({ channel: hub.adsChannel ?? "SHOPIFY", postedAt: at, eventAt: at, group: "advertising", type: "Meta ads", amount, currency, baseAmount: Math.round(amount * fx * 100) / 100, txId: `meta:${a.accountId}:${r.date_start}`, status: "released" });
    }
    await prisma.$transaction([
      prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance:${orgId}`}))`,
      prisma.financeEvent.deleteMany({ where: { txId: { in: days.map((d) => `meta:${a.accountId}:${d}`) } } }),
      ...(created.length ? [prisma.financeEvent.createMany({ data: created })] : []),
    ]);
    rows += created.length;
  }

  const since = a.since ?? zonedDayStart(from, tz);
  await prisma.metaAdAccount.update({
    where: { id: a.id },
    data: { syncedThrough: new Date(`${to}T00:00:00Z`), since, lastSyncAt: new Date(), lastError: null, ...(currency !== a.currency ? { currency } : {}) },
  });
  return { rows, since, through: to };
}

export async function importMetaAdsSpend(): Promise<{ rows: number; accounts: number } | null> {
  const hub = await metaHub();
  if (!hub) return null;
  let accounts = await prisma.metaAdAccount.findMany({ where: { status: "connected" }, orderBy: { connectedAt: "asc" } });
  if (!accounts.length) {
    const legacy = await adoptLegacyAccount(hub);
    if (!legacy) return null;
    accounts = [legacy];
  }
  const baseCurrency = (await getCurrentOrg())?.currencyCode ?? "USD";
  const orgId = (await getCurrentOrgId()) ?? "";
  let rows = 0;
  let since: Date | null = null;
  let through: string | null = null;

  for (const a of accounts) {
    try {
      const r = await readAccount(hub, a, orgId, baseCurrency);
      rows += r.rows;
      if (!since || r.since < since) since = r.since;
      if (!through || r.through > through) through = r.through;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await prisma.metaAdAccount.update({ where: { id: a.id }, data: { lastError: message, ...(isMetaAuthError(e) ? { status: "error" } : {}) } });
      console.error(`[meta ads] ${a.accountId} (${a.name}): ${message}`);
    }
  }

  const s = await getOrgSettings();
  await saveOrgSettings({
    ...(through ? { metaAdsSyncedThrough: new Date(`${through}T00:00:00Z`) } : {}),
    ...(since && (!s.metaAdsSince || since < s.metaAdsSince) ? { metaAdsSince: since } : {}),
  });
  await prismaBase.integration.update({ where: { id: hub.id }, data: { lastSyncAt: new Date(), lastError: null } });
  return { rows, accounts: accounts.length };
}
