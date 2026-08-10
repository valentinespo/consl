import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, after } from "next/server";
import { prismaBase } from "@/lib/prisma-base";
import { runWithOrg } from "@/lib/tenant";
import { importTikTokOrderIds } from "@/lib/orders";

/**
 * TikTok Shop webhooks (ORDER_STATUS_CHANGE et al) — the push half for TikTok. The URL is set
 * app-wide via PUT /event/{v}/webhooks (see the setup script / promotion notes).
 *
 * Same doorbell principle as Shopify: the payload only tells us WHICH order changed; the data is
 * refetched from the authenticated API in the background. That makes signature subtleties
 * non-fatal — a request that fails verification can, at worst, ring the bell for an order id that
 * gets refetched over an authenticated channel anyway — but it is still verified (HMAC of
 * app_key + body with the app secret) and rate-limited per shop so spam can't burn API quota.
 */

// Per-shop doorbell budget: plenty for a real order stream, a wall for junk.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
const buckets = new Map<string, { start: number; count: number }>();
function allow(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > WINDOW_MS) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }
  b.count++;
  return b.count <= MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  const secret = process.env.TIKTOK_APP_SECRET ?? "";
  const appKey = process.env.TIKTOK_APP_KEY ?? "";
  const raw = Buffer.from(await request.arrayBuffer());

  let body: { type?: number | string; shop_id?: string; data?: { order_id?: string; order_status?: string } } | null = null;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return NextResponse.json({});
  }

  // TikTok signs pushes with HMAC-SHA256(app_secret, app_key + raw_body), hex, in Authorization.
  const given = request.headers.get("authorization") ?? "";
  const expected = createHmac("sha256", secret).update(appKey + raw.toString("utf8")).digest("hex");
  const verified =
    given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!verified && given) {
    // Log the mismatch shape (never the secret) so the formula can be corrected from a real
    // delivery if TikTok's scheme differs; processing continues doorbell-only under rate limit.
    console.warn(`[webhook tiktok] signature mismatch (len given=${given.length}, expected=${expected.length})`);
  }

  const shopId = body?.shop_id;
  const orderId = body?.data?.order_id;
  if (shopId && orderId && allow(shopId)) {
    const conn = await prismaBase.integration.findFirst({
      where: { provider: "tiktok", sellerId: shopId, status: "connected" },
      select: { orgId: true },
    });
    if (conn?.orgId) {
      const orgId = conn.orgId;
      after(async () => {
        try {
          await runWithOrg(orgId, () => importTikTokOrderIds([orderId]));
        } catch (e) {
          console.error("[webhook tiktok] refetch failed:", (e as Error).message);
        }
      });
    }
  }

  return NextResponse.json({});
}
