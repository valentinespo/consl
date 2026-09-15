import "server-only";
import { prisma } from "@/lib/prisma";
import { getCurrentOrgId } from "@/lib/tenant";
import { shopifyGraphQL } from "@/lib/shopify";
import { tiktokApi, TIKTOK_API_VERSION } from "@/lib/tiktok";
import { getTikTokAccessToken } from "@/lib/tiktok-oauth";
import { importShopifyOrders, importTikTokOrders } from "@/lib/orders";
import { shopifyAccessToken } from "@/lib/shopify-oauth";

/**
 * The independent check for Shopify and TikTok orders — the belt to the importers' braces.
 * Once a day, for each of the last 14 UTC days, the platform is asked how many orders it created
 * that day and the answer is compared with what consl holds. A day that differs is re-read from
 * its start (the importers read by update time, so that covers every order created on or after
 * it), which fills a hole the pull or a webhook missed. Amazon has its own ledger heal and audit
 * walk; this gives the other two channels the same kind of second opinion, cheaply: 14 counting
 * calls per channel per day.
 */

const DAYS = 14;
const DAY = 86_400_000;

export type CountAudit = { channel: "SHOPIFY" | "TIKTOK"; days: number; mismatched: string[]; reimported: boolean };

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

function windowDays(): { day: string; from: Date; to: Date }[] {
  const todayStart = new Date(`${utcDay(new Date())}T00:00:00Z`).getTime();
  return Array.from({ length: DAYS }, (_, i) => {
    const from = new Date(todayStart - (DAYS - 1 - i) * DAY);
    return { day: utcDay(from), from, to: new Date(from.getTime() + DAY) };
  });
}

/** consl's orders per UTC day for one channel, from the window's first day on. */
async function ourCounts(channel: string, from: Date): Promise<Map<string, number>> {
  const orgId = await getCurrentOrgId();
  const rows = await prisma.$queryRaw<{ d: string; n: number }[]>`
    SELECT to_char(o."orderedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, COUNT(*)::int AS n
    FROM "SalesOrder" o WHERE o."orgId" = ${orgId} AND o.channel = ${channel} AND o."orderedAt" >= ${from}
    GROUP BY 1`;
  return new Map(rows.map((r) => [r.d, r.n]));
}

export async function auditShopifyOrderCounts(): Promise<CountAudit | null> {
  const conn = await prisma.integration.findFirst({ where: { provider: "shopify", status: "connected" } });
  if (!conn?.refreshTokenEnc || !conn.sellerId) return null;
  const token = await shopifyAccessToken(conn);
  const days = windowDays();
  const ours = await ourCounts("SHOPIFY", days[0].from);
  const mismatched: string[] = [];
  for (const d of days) {
    const data = await shopifyGraphQL<{ ordersCount: { count: number; precision: string } | null }>(
      conn.sellerId,
      token,
      `query($q: String) { ordersCount(query: $q, limit: 10000) { count precision } }`,
      { q: `created_at:>=${d.from.toISOString()} AND created_at:<${d.to.toISOString()}` },
    );
    const theirs = data.ordersCount?.count;
    if (theirs == null) continue;
    if (theirs !== (ours.get(d.day) ?? 0)) mismatched.push(d.day);
  }
  if (mismatched.length) await importShopifyOrders(new Date(`${mismatched[0]}T00:00:00Z`));
  return { channel: "SHOPIFY", days: days.length, mismatched, reimported: mismatched.length > 0 };
}

export async function auditTikTokOrderCounts(): Promise<CountAudit | null> {
  const conn = await prisma.integration.findFirst({ where: { provider: "tiktok", status: "connected" } });
  if (!conn?.marketplaceId || !conn.refreshTokenEnc) return null;
  const token = await getTikTokAccessToken(conn);
  const days = windowDays();
  const ours = await ourCounts("TIKTOK", days[0].from);
  const mismatched: string[] = [];
  for (const d of days) {
    // TikTok reports the match count with the first page; when it doesn't, the pages are counted.
    let theirs = 0;
    let pageToken: string | null = null;
    for (let page = 0; page < 50; page++) {
      type Page = { orders?: unknown[] | null; next_page_token?: string | null; total_count?: number | null };
      const data: Page = await tiktokApi<Page>({
        method: "POST",
        path: `/order/${TIKTOK_API_VERSION}/orders/search`,
        accessToken: token,
        query: { shop_cipher: conn.marketplaceId, page_size: "100", ...(pageToken ? { page_token: pageToken } : {}) },
        body: { create_time_ge: Math.floor(d.from.getTime() / 1000), create_time_lt: Math.floor(d.to.getTime() / 1000) },
      });
      if (typeof data.total_count === "number") {
        theirs = data.total_count;
        break;
      }
      theirs += data.orders?.length ?? 0;
      pageToken = data.next_page_token || null;
      if (!pageToken) break;
    }
    if (theirs !== (ours.get(d.day) ?? 0)) mismatched.push(d.day);
  }
  if (mismatched.length) await importTikTokOrders(new Date(`${mismatched[0]}T00:00:00Z`));
  return { channel: "TIKTOK", days: days.length, mismatched, reimported: mismatched.length > 0 };
}
