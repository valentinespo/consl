import "server-only";
import { prismaBase } from "@/lib/prisma-base";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/secret-box";
import { makeState, verifyState } from "@/lib/oauth-state";
import { APP_ORIGIN } from "@/lib/amazon-oauth";

export { makeState, verifyState };

/**
 * Meta Ads (Facebook / Instagram) — daily ad spend for the P&L.
 *
 * Connect: Facebook Login for Business. The brand's admin signs in, grants `ads_read`, and consl
 * exchanges the code for a user access token, then for a long-lived one (about 60 days). The
 * token is kept encrypted on the org's `meta_ads` Integration row and re-exchanged before it
 * expires; when Meta refuses (the person lost access, a password change), the row goes to
 * "error" and the Integrations card asks for a reconnect. The first active ad account the person
 * can see is recorded (`sellerId` = act_<id>); every insights call is scoped to it.
 *
 * Meta ads aren't a sales channel of their own, so the spend counts against the P&L channel the
 * connection names (`adsChannel`, Shopify by default when it is connected).
 */

export const META_GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const SCOPE = "ads_read";
const REFRESH_AHEAD_MS = 10 * 86_400_000;

export const META_ADS_REDIRECT_URI = `${APP_ORIGIN}/api/integrations/meta-ads/callback`;

export function metaAdsConfigured(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.INTEGRATION_ENC_KEY);
}

/** Meta's login dialog. A Login-for-Business configuration id, when set, carries the permissions. */
export function metaConsentUrl(orgId: string): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID ?? "",
    redirect_uri: META_ADS_REDIRECT_URI,
    state: makeState(orgId),
    response_type: "code",
  });
  if (process.env.META_LOGIN_CONFIG_ID) {
    params.set("config_id", process.env.META_LOGIN_CONFIG_ID);
    params.set("override_default_response_type", "true");
  } else params.set("scope", SCOPE);
  return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

type Token = { access_token: string; expires_in?: number };

async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const r = await fetch(`${GRAPH}${path}?${new URLSearchParams(params).toString()}`);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`Meta: ${j.error?.message ?? r.status}`);
  return j as T;
}

/** The one-time code → a user token, then its long-lived form. */
export async function exchangeMetaCode(code: string): Promise<Token> {
  const short = await graph<Token>("/oauth/access_token", {
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    redirect_uri: META_ADS_REDIRECT_URI,
    code,
  });
  return extendToken(short.access_token);
}

async function extendToken(token: string): Promise<Token> {
  return graph<Token>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    fb_exchange_token: token,
  });
}

type MetaIntegration = { id: string; refreshTokenEnc: string | null; accessTokenEnc: string | null; accessTokenExpiresAt: Date | null };

/** A usable token: the stored long-lived one, re-extended when it is within ten days of expiry. */
export async function getMetaAccessToken(i: MetaIntegration): Promise<string> {
  if (!i.accessTokenEnc) throw new Error("Meta Ads is not connected");
  const token = decryptSecret(i.accessTokenEnc);
  if (!i.accessTokenExpiresAt || i.accessTokenExpiresAt.getTime() - Date.now() > REFRESH_AHEAD_MS) return token;
  try {
    const t = await extendToken(token);
    await prismaBase.integration.update({
      where: { id: i.id },
      data: { accessTokenEnc: encryptSecret(t.access_token), accessTokenExpiresAt: new Date(Date.now() + (t.expires_in ?? 60 * 86_400) * 1000), lastError: null },
    });
    return t.access_token;
  } catch (e) {
    if (i.accessTokenExpiresAt.getTime() > Date.now()) return token; // still valid — try again next time
    await prismaBase.integration.update({ where: { id: i.id }, data: { status: "error", lastError: "Meta access expired — reconnect Meta Ads." } });
    throw e;
  }
}

export type MetaAdAccount = { id: string; account_id: string; name: string; currency: string; timezone_name: string; account_status: number };

export async function listMetaAdAccounts(token: string): Promise<MetaAdAccount[]> {
  const j = await graph<{ data: MetaAdAccount[] }>("/me/adaccounts", { access_token: token, fields: "id,account_id,name,currency,timezone_name,account_status", limit: "100" });
  return j.data ?? [];
}

/** Finish a connection: prove the token, pick the ad account, store everything encrypted. */
export async function completeMetaAdsConnection(orgId: string, token: Token): Promise<void> {
  const accounts = await listMetaAdAccounts(token.access_token);
  const account = accounts.find((a) => a.account_status === 1) ?? accounts[0];
  if (!account) throw new Error("This Facebook login has no ad account. Sign in with a person who manages your Meta ads.");
  const shopify = await prismaBase.integration.findFirst({ where: { orgId, provider: "shopify", status: "connected" }, select: { id: true } });
  const data = {
    status: "connected",
    refreshTokenEnc: null,
    accessTokenEnc: encryptSecret(token.access_token),
    accessTokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 60 * 86_400) * 1000),
    sellerId: account.id, // "act_<id>"
    marketplaceId: account.account_id,
    region: null,
    scope: SCOPE,
    timezone: account.timezone_name ?? null,
    adsChannel: shopify ? "SHOPIFY" : "AMAZON",
    connectedAt: new Date(),
    lastError: null,
  };
  await prismaBase.integration.upsert({
    where: { orgId_provider: { orgId, provider: "meta_ads" } },
    create: { orgId, provider: "meta_ads", ...data },
    update: data,
  });
}

/** The org's live Meta Ads connection with a usable token, or null. */
export async function metaClient(): Promise<{ token: string; account: string; currency: string | null; timezone: string; channel: string; integrationId: string } | null> {
  const i = await prisma.integration.findFirst({ where: { provider: "meta_ads", status: "connected" } });
  if (!i?.accessTokenEnc || !i.sellerId) return null;
  const token = await getMetaAccessToken(i);
  return { token, account: i.sellerId, currency: null, timezone: i.timezone ?? "America/Los_Angeles", channel: i.adsChannel ?? "SHOPIFY", integrationId: i.id };
}

export const metaGraph = graph;
