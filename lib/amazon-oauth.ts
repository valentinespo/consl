import "server-only";
import { prismaBase } from "@/lib/prisma-base";
import { encryptSecret } from "@/lib/secret-box";
import { ensureChannelFacilities } from "@/lib/integrations";
import { getMarketplaceParticipations, chooseMarketplace } from "@/lib/spapi";
import { makeState, verifyState } from "@/lib/oauth-state";

// The signed-state helpers moved to lib/oauth-state.ts (shared with the Shopify flow); re-exported
// so the Amazon routes keep importing them from here.
export { makeState, verifyState };

/**
 * Amazon SP-API "website authorization workflow" (per-seller OAuth), server-only.
 *
 * Connect: send the seller to Amazon's consent page for our SP-API app. Amazon redirects back to
 * the app's registered OAuth Redirect URI with a one-time `spapi_oauth_code`, which we exchange
 * (LWA, authorization_code grant) for that seller's long-lived refresh token — stored encrypted on
 * their org's Integration row. The app's own client id/secret + application id stay in env.
 *
 * The `state` is HMAC-signed (keyed off INTEGRATION_ENC_KEY) and carries the org id + a timestamp,
 * so the callback can't be forged or replayed and we know which tenant is connecting.
 */

const CONSENT_BASE: Record<string, string> = {
  na: "https://sellercentral.amazon.com/apps/authorize/consent",
  eu: "https://sellercentral-europe.amazon.com/apps/authorize/consent",
  fe: "https://sellercentral.amazon.co.jp/apps/authorize/consent",
};

export const APP_ORIGIN = process.env.APP_ORIGIN || "https://consl.ai";
export const AMAZON_REDIRECT_URI = `${APP_ORIGIN}/api/integrations/amazon/callback`;

/** True when the Amazon app is wired up enough to attempt a connect (env + encryption key). */
export function amazonOAuthConfigured(): boolean {
  return Boolean(process.env.SPAPI_APP_ID && process.env.SPAPI_CLIENT_ID && process.env.SPAPI_CLIENT_SECRET && process.env.INTEGRATION_ENC_KEY);
}

/** The Amazon consent URL to send the seller to. `version=beta` is required while the SP-API app
 *  is in Draft (self-authorization / testing); drop it once the app is published (SPAPI_APP_PUBLISHED=1). */
export function consentUrl(orgId: string, region = "na"): string {
  const base = CONSENT_BASE[region] ?? CONSENT_BASE.na;
  const params = new URLSearchParams({ application_id: process.env.SPAPI_APP_ID ?? "", state: makeState(orgId) });
  if (process.env.SPAPI_APP_PUBLISHED !== "1") params.set("version", "beta");
  return `${base}?${params.toString()}`;
}

/** Exchange the one-time authorization code for the seller's refresh token (LWA). */
export async function exchangeCode(code: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: AMAZON_REDIRECT_URI,
    client_id: process.env.SPAPI_CLIENT_ID ?? "",
    client_secret: process.env.SPAPI_CLIENT_SECRET ?? "",
  });
  const r = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) throw new Error(`Code exchange failed: ${j.error_description || j.error || r.status}`);
  return j.refresh_token as string;
}

/**
 * Complete a connection: validate the token against Amazon, pick the marketplace, and upsert the
 * org's Integration (encrypted token) + materialise its locked channel facilities. Uses the
 * unscoped client with an explicit, already-authorized orgId.
 */
export async function completeAmazonConnection(orgId: string, refreshToken: string, sellerId: string | null): Promise<void> {
  const region = "na";
  // Prove the token works before we store it; pick a marketplace the seller actually sells in.
  const marketplaces = await getMarketplaceParticipations(refreshToken, region);
  const marketplaceId = chooseMarketplace(marketplaces);

  await prismaBase.integration.upsert({
    where: { orgId_provider: { orgId, provider: "amazon" } },
    create: {
      orgId,
      provider: "amazon",
      status: "connected",
      refreshTokenEnc: encryptSecret(refreshToken),
      sellerId,
      marketplaceId,
      region,
      connectedAt: new Date(),
      lastError: null,
    },
    update: {
      status: "connected",
      refreshTokenEnc: encryptSecret(refreshToken),
      sellerId,
      marketplaceId,
      region,
      connectedAt: new Date(),
      lastError: null,
    },
  });

  await ensureChannelFacilities("amazon");
}
