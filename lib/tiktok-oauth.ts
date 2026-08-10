import "server-only";
import { prismaBase } from "@/lib/prisma-base";
import { encryptSecret, decryptSecret } from "@/lib/secret-box";
import { ensureChannelFacilities } from "@/lib/integrations";
import { tiktokApi, TIKTOK_API_VERSION } from "@/lib/tiktok";
import { syncTikTokWarehouses } from "@/lib/tiktok-locations";
import { runWithOrg } from "@/lib/tenant";

/**
 * TikTok Shop OAuth (authorized-code grant), server-only. The flow starts at TikTok's service
 * authorization page for our app; after consent TikTok redirects to the registered callback with a
 * one-time `auth_code` (?code=TTP_…) — and, unlike Amazon/Shopify, NO `state` echo, so the org is
 * bound to the signed-in owner completing the flow (see the callback route). The code is exchanged
 * for a short-lived access token plus a refresh token; BOTH rotate on every refresh, so both are
 * stored encrypted on the org's Integration row. One TikTok app (key/secret in env) serves every
 * tenant.
 */

export const APP_ORIGIN = process.env.APP_ORIGIN || "https://consl.ai";

const TIKTOK_AUTH_HOST = "https://auth.tiktok-shops.com";

export type TikTokTokenData = {
  access_token: string;
  access_token_expire_in: number; // unix seconds, absolute expiry
  refresh_token: string;
  refresh_token_expire_in: number; // unix seconds, absolute expiry
  open_id: string;
  seller_name: string;
  seller_base_region: string;
};

/** Token endpoints live on auth.tiktok-shops.com and are NOT signed — plain GET with app creds. */
async function tokenCall(endpoint: "get" | "refresh", params: Record<string, string>): Promise<TikTokTokenData> {
  const qs = new URLSearchParams({
    app_key: process.env.TIKTOK_APP_KEY ?? "",
    app_secret: process.env.TIKTOK_APP_SECRET ?? "",
    ...params,
  });
  const r = await fetch(`${TIKTOK_AUTH_HOST}/api/v2/token/${endpoint}?${qs.toString()}`);
  const j = (await r.json().catch(() => null)) as { code?: number; message?: string; data?: TikTokTokenData } | null;
  if (!j || !r.ok || j.code !== 0 || !j.data?.access_token) {
    throw new Error(`TikTok token ${endpoint} failed: ${j?.message || `HTTP ${r.status}`}`.slice(0, 300));
  }
  return j.data;
}

/** Exchange the one-time authorization code for the seller's token pair. */
export function exchangeTikTokCode(authCode: string): Promise<TikTokTokenData> {
  return tokenCall("get", { auth_code: authCode, grant_type: "authorized_code" });
}

/** Trade the current refresh token for a fresh token pair (both tokens rotate). */
export function refreshTikTokToken(refreshToken: string): Promise<TikTokTokenData> {
  return tokenCall("refresh", { refresh_token: refreshToken, grant_type: "refresh_token" });
}

type TikTokShop = {
  cipher: string; // required as shop_cipher on every shop-scoped API call
  code: string;
  id: string;
  name: string;
  region: string;
  seller_type: string;
};

/**
 * Complete a connection: exchange the code, resolve the authorized shop, and upsert the org's
 * Integration + materialise its warehouses as locked facilities. Unscoped client with an explicit,
 * already-authorized orgId — same as Amazon/Shopify.
 */
export async function completeTikTokConnection(orgId: string, authCode: string): Promise<void> {
  const tokens = await exchangeTikTokCode(authCode);

  // A custom-app authorization covers exactly one shop; take it. Its cipher (not its id) is what
  // every shop-scoped call needs.
  const shopsData = await tiktokApi<{ shops: TikTokShop[] }>({
    method: "GET",
    path: `/authorization/${TIKTOK_API_VERSION}/shops`,
    accessToken: tokens.access_token,
  });
  const shop = shopsData.shops?.[0];
  if (!shop) throw new Error("TikTok authorized no shop for this account.");

  // Column reuse (no TikTok-specific columns): sellerId = TikTok shop id, marketplaceId = the
  // shop_cipher, region = shop region (e.g. "US"). TikTok returns no scope string.
  const data = {
    status: "connected",
    refreshTokenEnc: encryptSecret(tokens.refresh_token),
    accessTokenEnc: encryptSecret(tokens.access_token),
    accessTokenExpiresAt: new Date(tokens.access_token_expire_in * 1000),
    sellerId: shop.id,
    marketplaceId: shop.cipher,
    region: shop.region,
    scope: null,
    connectedAt: new Date(),
    lastError: null,
  };
  await prismaBase.integration.upsert({
    where: { orgId_provider: { orgId, provider: "tiktok" } },
    create: { orgId, provider: "tiktok", ...data },
    update: data,
  });

  await ensureChannelFacilities("tiktok");

  // Materialise the shop's sales warehouses as facilities straight away, so the connection lands
  // with real places rather than an empty channel. The org is explicit here (the callback runs
  // with a session, but this must be bound to the org that authorized), and a failure here must
  // not undo an otherwise good connection — the next sync retries.
  try {
    await runWithOrg(orgId, () => syncTikTokWarehouses(tokens.access_token, shop.cipher));
  } catch {
    // leave the connection in place; warehouses sync again on the next run
  }

  // Pull the shop's catalog and auto-map exact matches, so the mapping screen the merchant lands
  // on is already pre-populated. Same failure posture: never undo a good connection.
  try {
    const { refreshTikTokListings, autoMapExact } = await import("@/lib/channel-catalog");
    await runWithOrg(orgId, async () => {
      await refreshTikTokListings();
      await autoMapExact("TIKTOK");
    });
  } catch {
    // the Refresh button on the mapping screen retries
  }
}

// Refresh when the cached access token is within 10 minutes of expiry — comfortably wider than
// any request's lifetime, narrow enough to use most of the ~7-day token.
const ACCESS_TOKEN_MARGIN_MS = 10 * 60 * 1000;

/**
 * The current usable access token for a TikTok connection. Uses the cached one while it's fresh;
 * otherwise refreshes and persists the rotated pair (TikTok rotates the REFRESH token too — losing
 * the new one would strand the connection at the old, now-dead refresh token).
 */
export async function getTikTokAccessToken(integration: {
  id: string;
  refreshTokenEnc: string | null;
  accessTokenEnc: string | null;
  accessTokenExpiresAt: Date | null;
}): Promise<string> {
  const { accessTokenEnc, accessTokenExpiresAt } = integration;
  if (accessTokenEnc && accessTokenExpiresAt && accessTokenExpiresAt.getTime() - Date.now() > ACCESS_TOKEN_MARGIN_MS) {
    return decryptSecret(accessTokenEnc);
  }
  if (!integration.refreshTokenEnc) throw new Error("TikTok Shop is not connected");
  const t = await refreshTikTokToken(decryptSecret(integration.refreshTokenEnc));
  await prismaBase.integration.update({
    where: { id: integration.id },
    data: {
      refreshTokenEnc: encryptSecret(t.refresh_token),
      accessTokenEnc: encryptSecret(t.access_token),
      accessTokenExpiresAt: new Date(t.access_token_expire_in * 1000),
    },
  });
  return t.access_token;
}
