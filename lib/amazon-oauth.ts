import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prismaBase } from "@/lib/prisma-base";
import { encryptSecret } from "@/lib/secret-box";
import { ensureChannelFacilities } from "@/lib/integrations";
import { getMarketplaceParticipations, chooseMarketplace } from "@/lib/spapi";

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

const STATE_TTL_MS = 15 * 60 * 1000; // a consent flow older than 15 min is stale

export const APP_ORIGIN = process.env.APP_ORIGIN || "https://consl.ai";
export const AMAZON_REDIRECT_URI = `${APP_ORIGIN}/api/integrations/amazon/callback`;

/** True when the Amazon app is wired up enough to attempt a connect (env + encryption key). */
export function amazonOAuthConfigured(): boolean {
  return Boolean(process.env.SPAPI_APP_ID && process.env.SPAPI_CLIENT_ID && process.env.SPAPI_CLIENT_SECRET && process.env.INTEGRATION_ENC_KEY);
}

function hmacKey(): Buffer {
  const b64 = process.env.INTEGRATION_ENC_KEY;
  if (!b64) throw new Error("INTEGRATION_ENC_KEY is not set");
  return Buffer.from(b64, "base64");
}

function sign(payload: string): string {
  return createHmac("sha256", hmacKey()).update(payload).digest("base64url");
}

/** Signed, time-limited state binding this consent flow to one org. */
export function makeState(orgId: string): string {
  const payload = `${orgId}.${Date.now()}.${randomBytes(8).toString("hex")}`;
  return Buffer.from(`${payload}.${sign(payload)}`).toString("base64url");
}

/** Returns the orgId if the state is authentic and fresh; null otherwise. */
export function verifyState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const i = decoded.lastIndexOf(".");
    if (i < 0) return null;
    const payload = decoded.slice(0, i);
    const sig = decoded.slice(i + 1);
    const expected = sign(payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const [orgId, tsStr] = payload.split(".");
    if (!orgId || !tsStr) return null;
    if (Date.now() - Number(tsStr) > STATE_TTL_MS) return null;
    return orgId;
  } catch {
    return null;
  }
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
