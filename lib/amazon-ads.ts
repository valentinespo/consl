import "server-only";
import { prismaBase } from "@/lib/prisma-base";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/secret-box";
import { makeState, verifyState } from "@/lib/oauth-state";
import { APP_ORIGIN } from "@/lib/amazon-oauth";

export { makeState, verifyState };

/**
 * Amazon Ads — the advertising side of Amazon, a separate API from the seller (SP-API) one, with
 * its own Login with Amazon client. Connect: the seller grants consl the campaign-management scope
 * on Amazon's consent page; the code is exchanged for a refresh token (kept encrypted on the
 * org's `amazon_ads` Integration row) and the seller's advertising PROFILE for the connected
 * marketplace is recorded — every reporting call is scoped to that profile. Access tokens live an
 * hour and are cached on the row like TikTok's.
 */

const REGION_HOST: Record<string, string> = {
  na: "https://advertising-api.amazon.com",
  eu: "https://advertising-api-eu.amazon.com",
  fe: "https://advertising-api-fe.amazon.com",
};
const TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const SCOPE = "advertising::campaign_management";
const ACCESS_MARGIN_MS = 5 * 60_000;

export const AMAZON_ADS_REDIRECT_URI = `${APP_ORIGIN}/api/integrations/amazon-ads/callback`;

export function amazonAdsConfigured(): boolean {
  return Boolean(process.env.AMAZON_ADS_CLIENT_ID && process.env.AMAZON_ADS_CLIENT_SECRET && process.env.INTEGRATION_ENC_KEY);
}

/** Amazon's consent page for the Ads scope; `state` carries the org, signed. */
export function adsConsentUrl(orgId: string): string {
  const params = new URLSearchParams({
    client_id: process.env.AMAZON_ADS_CLIENT_ID ?? "",
    scope: SCOPE,
    response_type: "code",
    redirect_uri: AMAZON_ADS_REDIRECT_URI,
    state: makeState(orgId),
  });
  return `https://www.amazon.com/ap/oa?${params.toString()}`;
}

type Tokens = { access_token: string; refresh_token: string; expires_in: number };

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, client_id: process.env.AMAZON_ADS_CLIENT_ID ?? "", client_secret: process.env.AMAZON_ADS_CLIENT_SECRET ?? "" }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`Amazon Ads token: ${j.error_description || j.error || r.status}`);
  return j as Tokens;
}

export function exchangeAdsCode(code: string): Promise<Tokens> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: AMAZON_ADS_REDIRECT_URI });
}

type AdsIntegration = { id: string; refreshTokenEnc: string | null; accessTokenEnc: string | null; accessTokenExpiresAt: Date | null };

/** A live access token for the connection — the cached one while it has minutes left, else a fresh one. */
export async function getAdsAccessToken(i: AdsIntegration): Promise<string> {
  if (i.accessTokenEnc && i.accessTokenExpiresAt && i.accessTokenExpiresAt.getTime() - Date.now() > ACCESS_MARGIN_MS) return decryptSecret(i.accessTokenEnc);
  if (!i.refreshTokenEnc) throw new Error("Amazon Ads is not connected");
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decryptSecret(i.refreshTokenEnc) });
  await prismaBase.integration.update({
    where: { id: i.id },
    data: {
      accessTokenEnc: encryptSecret(t.access_token),
      accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
      ...(t.refresh_token ? { refreshTokenEnc: encryptSecret(t.refresh_token) } : {}),
    },
  });
  return t.access_token;
}

export type AdsProfile = {
  profileId: number | string;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  accountInfo: { marketplaceStringId: string; id: string; type: string; name?: string };
};

function adsHeaders(accessToken: string, profileId?: string | null, accountId?: string | null): Record<string, string> {
  const clientId = process.env.AMAZON_ADS_CLIENT_ID ?? "";
  return {
    Authorization: `Bearer ${accessToken}`,
    "Amazon-Advertising-API-ClientId": clientId,
    "Amazon-Ads-ClientId": clientId,
    ...(profileId ? { "Amazon-Advertising-API-Scope": profileId } : {}),
    ...(accountId ? { "Amazon-Ads-AccountId": accountId } : {}),
  };
}

/** Every advertising profile the signed-in Amazon user can act for, in one region. */
export async function listAdsProfiles(accessToken: string, region = "na"): Promise<AdsProfile[]> {
  const r = await fetch(`${REGION_HOST[region] ?? REGION_HOST.na}/v2/profiles`, { headers: adsHeaders(accessToken) });
  const j = await r.json();
  if (!r.ok) throw new Error(`Amazon Ads profiles: ${JSON.stringify(j).slice(0, 160)}`);
  return j as AdsProfile[];
}

/** The advertising account id behind a profile (the Accounts API), for the reporting header.
 *  Best effort — older accounts report fine on the profile scope alone. */
export async function findAdsAccountId(accessToken: string, profile: AdsProfile, region = "na"): Promise<string | null> {
  try {
    const r = await fetch(`${REGION_HOST[region] ?? REGION_HOST.na}/adsAccounts/list`, {
      method: "POST",
      headers: { ...adsHeaders(accessToken), "Content-Type": "application/vnd.listaccountsresource.v1+json", Accept: "application/vnd.listaccountsresource.v1+json" },
      body: JSON.stringify({ maxResults: 100 }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { adsAccounts?: Array<{ adsAccountId?: string; alternateIds?: Array<{ profileId?: number | string; countryCode?: string }> }> };
    const hit = (j.adsAccounts ?? []).find((a) => (a.alternateIds ?? []).some((x) => String(x.profileId) === String(profile.profileId)));
    return hit?.adsAccountId ?? null;
  } catch {
    return null;
  }
}

/**
 * Finish a connection: prove the token, pick the seller profile of the marketplace the org's
 * Amazon selling connection uses (else the first seller profile), and store everything encrypted.
 */
export async function completeAmazonAdsConnection(orgId: string, tokens: Tokens): Promise<void> {
  const region = "na";
  const profiles = await listAdsProfiles(tokens.access_token, region);
  const selling = await prismaBase.integration.findFirst({ where: { orgId, provider: "amazon" }, select: { marketplaceId: true } });
  const sellers = profiles.filter((p) => (p.accountInfo?.type ?? "").toLowerCase() === "seller");
  const profile =
    sellers.find((p) => selling?.marketplaceId && p.accountInfo.marketplaceStringId === selling.marketplaceId) ??
    sellers.find((p) => p.countryCode === "US") ??
    sellers[0] ??
    profiles[0];
  if (!profile) throw new Error("This Amazon login has no advertising profile. Sign in with the account that runs your Amazon Ads.");
  const accountId = await findAdsAccountId(tokens.access_token, profile, region);

  const data = {
    status: "connected",
    refreshTokenEnc: encryptSecret(tokens.refresh_token),
    accessTokenEnc: encryptSecret(tokens.access_token),
    accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    sellerId: profile.accountInfo?.id ?? null,
    marketplaceId: profile.accountInfo?.marketplaceStringId ?? null,
    region,
    scope: SCOPE,
    timezone: profile.timezone ?? null,
    adsProfileId: String(profile.profileId),
    adsAccountId: accountId,
    connectedAt: new Date(),
    lastError: null,
  };
  await prismaBase.integration.upsert({
    where: { orgId_provider: { orgId, provider: "amazon_ads" } },
    create: { orgId, provider: "amazon_ads", ...data },
    update: data,
  });
}

/** The org's live Ads connection with a usable token, or null. */
export async function adsClient(): Promise<{ host: string; headers: Record<string, string>; timezone: string | null; integrationId: string } | null> {
  const i = await prisma.integration.findFirst({ where: { provider: "amazon_ads", status: "connected" } });
  if (!i?.refreshTokenEnc || !i.adsProfileId) return null;
  const token = await getAdsAccessToken(i);
  return { host: REGION_HOST[i.region ?? "na"] ?? REGION_HOST.na, headers: adsHeaders(token, i.adsProfileId, i.adsAccountId), timezone: i.timezone, integrationId: i.id };
}
