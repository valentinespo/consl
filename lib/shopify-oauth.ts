import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prismaBase } from "@/lib/prisma-base";
import { encryptSecret } from "@/lib/secret-box";
import { ensureChannelFacilities } from "@/lib/integrations";
import { makeState } from "@/lib/oauth-state";
import { shopifyGraphQL } from "@/lib/shopify";
import { syncShopifyLocations } from "@/lib/shopify-locations";
import { runWithOrg } from "@/lib/tenant";

/**
 * Shopify OAuth (authorization-code grant), server-only. Unlike Amazon, the flow STARTS at the
 * merchant's shop domain: we send them to https://{shop}/admin/oauth/authorize for our app, and
 * Shopify returns them to the registered callback with a one-time `code` plus an `hmac` signed
 * with the app secret. We verify our own signed `state` (org binding) AND Shopify's hmac, then
 * exchange the code for the shop's permanent offline access token — stored encrypted on the org's
 * Integration row. One Shopify app (key/secret in env) serves every tenant.
 */

export const APP_ORIGIN = process.env.APP_ORIGIN || "https://consl.ai";
export const SHOPIFY_REDIRECT_URI = `${APP_ORIGIN}/api/integrations/shopify/callback`;

/** Read-only v1: catalog + orders (velocity, incl. >60d history for the 90-day window) +
 *  inventory by location. Must match the scopes declared in the app's Partner-dashboard
 *  configuration when the app uses Shopify-managed installation. */
export const SHOPIFY_SCOPES = "read_products,read_orders,read_all_orders,read_inventory,read_locations";

export function shopifyOAuthConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET && process.env.INTEGRATION_ENC_KEY);
}

/**
 * Normalise what a person types into a canonical *.myshopify.com domain, or null if it can't be
 * one. Accepts "herbl", "herbl.myshopify.com", or a pasted admin URL; a custom storefront domain
 * (herbl.co) can't start OAuth — only the myshopify domain can.
 */
export function normalizeShopDomain(raw: string): string | null {
  let s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").split("/")[0].split("?")[0];
  // Pasted from the new admin? admin.shopify.com/store/<handle>
  const adminMatch = raw.trim().toLowerCase().match(/admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (adminMatch) s = `${adminMatch[1]}.myshopify.com`;
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : null;
}

/** The consent URL on the merchant's own shop. */
export function authorizeUrl(shop: string, orgId: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY ?? "",
    scope: SHOPIFY_SCOPES,
    redirect_uri: SHOPIFY_REDIRECT_URI,
    state: makeState(orgId),
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Shopify signs every callback: hmac = HMAC-SHA256(secret, sorted "k=v" pairs of all params
 * except `hmac`/`signature`, joined with "&"), hex-encoded. Anyone can hit our callback URL;
 * only Shopify can produce this signature.
 */
export function verifyCallbackHmac(url: URL): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  const given = url.searchParams.get("hmac");
  if (!secret || !given) return false;
  const pairs: string[] = [];
  for (const [k, v] of url.searchParams.entries()) {
    if (k === "hmac" || k === "signature") continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const digest = createHmac("sha256", secret).update(pairs.join("&")).digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Exchange the one-time code for the shop's permanent offline access token. */
export async function exchangeShopifyCode(shop: string, code: string): Promise<{ accessToken: string; scope: string | null }> {
  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY ?? "",
      client_secret: process.env.SHOPIFY_API_SECRET ?? "",
      code,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(`Token exchange failed: ${j.error_description || j.error || r.status}`);
  }
  return { accessToken: j.access_token as string, scope: (j.scope as string) ?? null };
}

/**
 * Complete a connection: prove the token works against the shop, then upsert the org's
 * Integration (encrypted token, sellerId = myshopify domain) and materialise the locked SHOP
 * facility. Unscoped client with an explicit, already-authorized orgId — same as Amazon.
 */
export async function completeShopifyConnection(orgId: string, shop: string, accessToken: string, scope: string | null): Promise<void> {
  const data = await shopifyGraphQL<{ shop: { name: string; myshopifyDomain: string } }>(
    shop,
    accessToken,
    `{ shop { name myshopifyDomain } }`,
  );
  const canonical = data.shop.myshopifyDomain?.toLowerCase() || shop;

  await prismaBase.integration.upsert({
    where: { orgId_provider: { orgId, provider: "shopify" } },
    create: {
      orgId,
      provider: "shopify",
      status: "connected",
      refreshTokenEnc: encryptSecret(accessToken),
      sellerId: canonical,
      scope,
      connectedAt: new Date(),
      lastError: null,
    },
    update: {
      status: "connected",
      refreshTokenEnc: encryptSecret(accessToken),
      sellerId: canonical,
      scope,
      connectedAt: new Date(),
      lastError: null,
    },
  });

  await ensureChannelFacilities("shopify");

  // Materialise the shop's locations as facilities straight away, so the connection lands with
  // real places rather than an empty channel. The org is explicit here (the callback runs with a
  // session, but this must be bound to the org the flow was started for), and a failure here must
  // not undo an otherwise good connection — the next sync retries.
  try {
    const amazon = await prismaBase.integration.findFirst({
      where: { orgId, provider: "amazon", status: "connected" },
      select: { id: true },
    });
    await runWithOrg(orgId, () => syncShopifyLocations(shop, accessToken, { amazonConnected: !!amazon }));
  } catch {
    // leave the connection in place; locations sync again on the next run
  }

  // Pull the shop's catalog and auto-map exact matches, so the mapping screen the merchant lands
  // on is already pre-populated. Same failure posture: never undo a good connection.
  // Order webhooks: subscribe this environment's URL as part of the connect, so pushes start
  // flowing immediately. Failure must never undo a good connection — the daily ensure retries.
  try {
    const { ensureShopifyWebhooks } = await import("@/lib/shopify-webhooks");
    await runWithOrg(orgId, () => ensureShopifyWebhooks());
  } catch {
    // retried daily
  }

  try {
    const { refreshShopifyListings, autoMapExact } = await import("@/lib/channel-catalog");
    await runWithOrg(orgId, async () => {
      await refreshShopifyListings();
      await autoMapExact("SHOPIFY");
    });
  } catch {
    // the Refresh button on the mapping screen retries
  }
}
