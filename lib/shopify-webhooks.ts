import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-box";
import { shopifyGraphQL } from "@/lib/shopify";

/**
 * Keep this environment's Shopify order-webhook subscriptions registered for the current org's
 * shop. Idempotent by (topic, callback URL) — safe on every connect and on the daily sync, which
 * makes the setup self-healing: an environment registers its own URL the first day it runs with a
 * connection (that's also how production picks itself up after a promote, with no manual step).
 *
 * Staging and production subscribe their own URLs side by side on the same app+shop; Shopify
 * delivers to both and prunes an address only after it fails consistently — harmless while one
 * environment doesn't have the route deployed yet.
 */

const TOPICS = ["ORDERS_CREATE", "ORDERS_UPDATED", "ORDERS_CANCELLED", "REFUNDS_CREATE"] as const;

export async function ensureShopifyWebhooks(): Promise<{ created: number; present: number }> {
  const conn = await prisma.integration.findFirst({ where: { provider: "shopify", status: "connected" } });
  if (!conn?.refreshTokenEnc || !conn.sellerId) return { created: 0, present: 0 };
  const origin = process.env.APP_ORIGIN;
  if (!origin) return { created: 0, present: 0 };
  const token = decryptSecret(conn.refreshTokenEnc);
  const callbackUrl = `${origin}/api/webhooks/shopify`;

  const existing: {
    webhookSubscriptions: {
      nodes: Array<{ topic: string; endpoint: { callbackUrl?: string } | null }>;
    };
  } = await shopifyGraphQL(
    conn.sellerId,
    token,
    `{ webhookSubscriptions(first: 50) { nodes { topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } } }`,
  );
  const have = new Set(
    existing.webhookSubscriptions.nodes
      .filter((n) => n.endpoint?.callbackUrl === callbackUrl)
      .map((n) => n.topic),
  );

  let created = 0;
  for (const topic of TOPICS) {
    if (have.has(topic)) continue;
    const res: { webhookSubscriptionCreate: { userErrors: Array<{ message: string }> } } = await shopifyGraphQL(
      conn.sellerId,
      token,
      `mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
          userErrors { message }
        }
      }`,
      { topic, sub: { callbackUrl, format: "JSON" } },
    );
    const errs = res.webhookSubscriptionCreate?.userErrors ?? [];
    if (errs.length) console.error(`[shopify webhooks] ${topic}: ${errs.map((e) => e.message).join("; ")}`);
    else created++;
  }
  return { created, present: have.size };
}
