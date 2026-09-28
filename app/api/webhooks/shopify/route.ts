import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, after } from "next/server";
import { prismaBase } from "@/lib/prisma-base";
import { runWithOrg } from "@/lib/tenant";
import { importShopifyOrderById } from "@/lib/orders";
import { shopifyAppFor } from "@/lib/shopify-oauth";
import { clearShopifyPlan } from "@/lib/shopify-billing";

/**
 * Shopify webhooks — the push half of the orders feed, and of the shop's places. Subscribed to
 * orders/create, orders/updated, orders/cancelled and refunds/create (see lib/shopify-webhooks.ts),
 * so a sale, edit, cancellation or refund lands in consl seconds after it happens; and to the
 * locations/* topics, so a location added, renamed, retired or revived becomes or updates its
 * facility (and its stock is read) before any order can name it.
 *
 * The payload is a DOORBELL, not data: after verifying Shopify's HMAC we only take the order id,
 * answer 200 immediately, and refetch that order from the API in the background (`after`). That
 * keeps the handler fast (Shopify drops subscriptions that respond slowly), makes a forged payload
 * worthless, and guarantees the stored order always matches the API's canonical shape.
 *
 * The tenant is resolved from the shop domain header → Integration.sellerId. The 15-minute pull
 * remains as reconciliation for anything a webhook misses.
 */
export async function POST(request: Request) {
  const secrets = [process.env.SHOPIFY_API_SECRET, process.env.SHOPIFY_API_SECRET_ALT].filter(
    (s): s is string => Boolean(s),
  );
  const given = request.headers.get("x-shopify-hmac-sha256");
  const raw = Buffer.from(await request.arrayBuffer());
  if (!secrets.length || !given) return new NextResponse(null, { status: 401 });

  const b = Buffer.from(given);
  const signedWith = secrets.find((secret) => {
    const a = Buffer.from(createHmac("sha256", secret).update(raw).digest("base64"));
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!signedWith) return new NextResponse(null, { status: 401 });
  // Which of the two apps sent it: the private app signs with SHOPIFY_API_SECRET, the public one
  // with the other secret. A store can hold both, so an uninstall only ends the matching app's link.
  const appKind = signedWith === process.env.SHOPIFY_API_SECRET ? "default" : "public";

  const shopDomain = request.headers.get("x-shopify-shop-domain");
  const topic = request.headers.get("x-shopify-topic") ?? "";
  let payload: { id?: number | string; admin_graphql_api_id?: string; order_id?: number | string } | null = null;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return NextResponse.json({}); // signed but unparseable — acknowledge, nothing to do
  }

  // consl removed from the store: the connection ends (the token is dead), and a plan paid through
  // Shopify ends with it — Shopify cancels app charges on uninstall, so the company goes back to
  // the billing gate, which asks it to reinstall and pick a plan again. Data already imported stays.
  if (shopDomain && topic === "app/uninstalled") {
    const conns = await prismaBase.integration.findMany({
      where: { provider: "shopify", sellerId: shopDomain, status: { in: ["connected", "error"] } },
      select: { id: true, orgId: true },
    });
    for (const c of conns) {
      if (!c.orgId || (await shopifyAppFor(c.orgId)) !== appKind) continue;
      await prismaBase.integration.update({ where: { id: c.id }, data: { status: "revoked", lastError: "consl was uninstalled from the Shopify store" } });
      if (appKind === "public") await clearShopifyPlan(c.orgId);
      console.log(`[webhook shopify] ${shopDomain} uninstalled consl — connection closed for org ${c.orgId}`);
    }
    return NextResponse.json({});
  }

  // Location topics: a doorbell for the shop's PLACES — re-read them and their stock. The payload
  // is ignored (which location changed doesn't matter; the re-read is one cheap query).
  if (shopDomain && topic.startsWith("locations/")) {
    const conn = await prismaBase.integration.findFirst({
      where: { provider: "shopify", sellerId: shopDomain, status: "connected" },
      select: { orgId: true },
    });
    if (conn?.orgId) {
      const orgId = conn.orgId;
      after(async () => {
        try {
          await runWithOrg(orgId, async () => {
            const { refreshChannelPlaces } = await import("@/lib/fulfillment");
            const { syncShopifyStock } = await import("@/lib/channel-stock");
            await refreshChannelPlaces("SHOPIFY");
            await syncShopifyStock();
          });
        } catch (e) {
          console.error("[webhook shopify] places refresh failed:", (e as Error).message);
        }
      });
    }
    return NextResponse.json({});
  }

  // Order topics carry the order's own id; refunds/create carries order_id instead.
  const numericId = topic.startsWith("refunds/") ? payload?.order_id : payload?.id;
  const orderGid =
    payload?.admin_graphql_api_id && !topic.startsWith("refunds/")
      ? payload.admin_graphql_api_id
      : numericId
        ? `gid://shopify/Order/${numericId}`
        : null;

  if (shopDomain && orderGid) {
    const conn = await prismaBase.integration.findFirst({
      where: { provider: "shopify", sellerId: shopDomain, status: "connected" },
      select: { orgId: true },
    });
    if (conn?.orgId) {
      const orgId = conn.orgId;
      after(async () => {
        try {
          await runWithOrg(orgId, () => importShopifyOrderById(orderGid));
        } catch (e) {
          console.error("[webhook shopify] refetch failed:", (e as Error).message);
        }
      });
    }
  }

  // Always 200 for a signed request — retries can't fix an unknown shop or missing id.
  return NextResponse.json({});
}
