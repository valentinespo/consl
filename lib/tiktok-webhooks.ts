import "server-only";
import { prisma } from "@/lib/prisma";
import { tiktokApi, TIKTOK_API_VERSION } from "@/lib/tiktok";
import { getTikTokAccessToken } from "@/lib/tiktok-oauth";

/**
 * Keep TikTok Shop's push address pointed at consl. Unlike Shopify, a TikTok app holds ONE
 * address per event type, shared by every shop that authorized the app — so there is no
 * side-by-side staging/production registration: every environment registers the same
 * PRODUCTION address (TIKTOK_WEBHOOK_ORIGIN, default https://consl.ai) and only that environment
 * receives pushes (a push for a shop it doesn't know is a no-op; the 15-minute pull covers the
 * rest). Set TIKTOK_WEBHOOK_ORIGIN on staging only while testing pushes there on purpose.
 *
 * Idempotent: reads what is registered and writes only what differs. Runs on connect and on the
 * nightly sync, so a lost or wrong address heals itself. Never throws — a failure here must not
 * undo a good connection or stop the sync; it is logged and retried next time.
 */

// Order-level events; each payload names the order, which the receiver refetches from the API.
const EVENTS = ["ORDER_STATUS_CHANGE", "CANCELLATION_STATUS_CHANGE", "RETURN_STATUS_CHANGE"] as const;

export async function ensureTikTokWebhooks(): Promise<{ set: number; present: number }> {
  try {
    const conn = await prisma.integration.findFirst({ where: { provider: "tiktok", status: "connected" } });
    if (!conn?.marketplaceId || !conn.refreshTokenEnc) return { set: 0, present: 0 };
    const origin = process.env.TIKTOK_WEBHOOK_ORIGIN || "https://consl.ai";
    const address = `${origin}/api/webhooks/tiktok`;
    const token = await getTikTokAccessToken(conn);
    const query = { shop_cipher: conn.marketplaceId };

    const current = await tiktokApi<{ webhooks?: Array<{ event_type: string; address: string }>; total_count?: number }>({
      method: "GET",
      path: `/event/${TIKTOK_API_VERSION}/webhooks`,
      accessToken: token,
      query,
    });
    const have = new Map((current.webhooks ?? []).map((w) => [w.event_type, w.address]));

    let set = 0;
    for (const event_type of EVENTS) {
      if (have.get(event_type) === address) continue;
      await tiktokApi({ method: "PUT", path: `/event/${TIKTOK_API_VERSION}/webhooks`, accessToken: token, query, body: { event_type, address } });
      set++;
    }
    if (set > 0) console.log(`[tiktok webhooks] ${set} event address(es) set to ${address}`);
    return { set, present: have.size };
  } catch (e) {
    console.error("[tiktok webhooks] ensure failed:", (e as Error).message);
    return { set: 0, present: 0 };
  }
}
