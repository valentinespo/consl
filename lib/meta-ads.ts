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
 * "error" and the Integrations card asks for a reconnect. With a Login-for-Business configuration
 * that asks for a business portfolio, the token is a system-user token that never expires and
 * Meta's own dialog is where the person ticks the ad accounts to share — each one becomes a
 * `MetaAdAccount` row with that token; the `meta_ads` Integration row is the hub (channel, status).
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

/**
 * The one-time code → a token. A personal user token is short-lived and gets its 60-day form; a
 * system-user token (business-portfolio login) comes back without an expiry and stays as it is.
 */
export async function exchangeMetaCode(code: string): Promise<Token> {
  const t = await graph<Token>("/oauth/access_token", {
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    redirect_uri: META_ADS_REDIRECT_URI,
    code,
  });
  if (!t.expires_in) return { access_token: t.access_token };
  try {
    return await extendToken(t.access_token);
  } catch {
    return t;
  }
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

export type MetaAdAccount = { id: string; account_id: string; name: string; currency: string; timezone_name: string; account_status: number; business?: { id: string; name: string } };
const ACCOUNT_FIELDS = "id,account_id,name,currency,timezone_name,account_status,business{id,name}";

/** The ad accounts this token may read — with a system-user token, exactly the ones ticked in Meta's dialog. */
export async function listMetaAdAccounts(token: string): Promise<MetaAdAccount[]> {
  const j = await graph<{ data: MetaAdAccount[] }>("/me/adaccounts", { access_token: token, fields: ACCOUNT_FIELDS, limit: "100" });
  return j.data ?? [];
}

export async function describeAdAccount(token: string, accountId: string): Promise<MetaAdAccount> {
  return graph<MetaAdAccount>(`/${accountId}`, { access_token: token, fields: ACCOUNT_FIELDS });
}

type AccountRow = { id: string; accessTokenEnc: string | null; accessTokenExpiresAt: Date | null };

/** A usable token for one linked ad account; a never-expiring system-user token passes straight through. */
export async function getMetaAccountToken(a: AccountRow): Promise<string> {
  if (!a.accessTokenEnc) throw new Error("This ad account has no Meta access — reconnect Meta Ads.");
  const token = decryptSecret(a.accessTokenEnc);
  if (!a.accessTokenExpiresAt || a.accessTokenExpiresAt.getTime() - Date.now() > REFRESH_AHEAD_MS) return token;
  try {
    const t = await extendToken(token);
    await prismaBase.metaAdAccount.update({
      where: { id: a.id },
      data: { accessTokenEnc: encryptSecret(t.access_token), accessTokenExpiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null, lastError: null },
    });
    return t.access_token;
  } catch (e) {
    if (a.accessTokenExpiresAt.getTime() > Date.now()) return token; // still valid — try again next time
    await prismaBase.metaAdAccount.update({ where: { id: a.id }, data: { status: "error", lastError: "Meta access expired — reconnect Meta Ads." } });
    throw e;
  }
}

/** Meta's "this token no longer works here" family: consl was revoked, or the account was taken away. */
export function isMetaAuthError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /\(#190\)|\(#10\)|\(#200\)|access token|permission/i.test(m);
}

const accountData = (a: MetaAdAccount) => ({
  accountNumber: a.account_id ?? null,
  name: a.name || a.id,
  currency: a.currency ?? null,
  timezone: a.timezone_name ?? null,
  businessId: a.business?.id ?? null,
  businessName: a.business?.name ?? null,
});

/**
 * Finish a connection pass: prove the token, record every ad account it grants, keep the hub row.
 * A pass replaces the selection for the portfolios it covers (an account unticked this time drops
 * off together with its spend rows); accounts linked from other portfolios in earlier passes stay.
 */
export async function completeMetaAdsConnection(orgId: string, token: Token): Promise<{ accounts: number }> {
  const accounts = await listMetaAdAccounts(token.access_token);
  if (!accounts.length) throw new Error("No ad account was shared. In Meta's dialog, tick at least one ad account for consl.");
  const [shopify, existing] = await Promise.all([
    prismaBase.integration.findFirst({ where: { orgId, provider: "shopify", status: "connected" }, select: { id: true } }),
    prismaBase.integration.findFirst({ where: { orgId, provider: "meta_ads" }, select: { adsChannel: true } }),
  ]);
  const enc = encryptSecret(token.access_token);
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
  const first = accounts[0];
  const hub = {
    status: "connected",
    refreshTokenEnc: null,
    accessTokenEnc: enc,
    accessTokenExpiresAt: expiresAt,
    sellerId: first.id, // "act_<id>"
    marketplaceId: first.account_id,
    region: null,
    scope: SCOPE,
    timezone: first.timezone_name ?? null,
    adsChannel: existing?.adsChannel ?? (shopify ? "SHOPIFY" : "AMAZON"),
    connectedAt: new Date(),
    lastError: null,
  };
  await prismaBase.$transaction(async (tx) => {
    await tx.integration.upsert({
      where: { orgId_provider: { orgId, provider: "meta_ads" } },
      create: { orgId, provider: "meta_ads", ...hub },
      update: hub,
    });
    for (const a of accounts) {
      await tx.metaAdAccount.upsert({
        where: { orgId_accountId: { orgId, accountId: a.id } },
        create: { orgId, accountId: a.id, ...accountData(a), accessTokenEnc: enc, accessTokenExpiresAt: expiresAt, status: "connected", connectedAt: new Date() },
        update: { ...accountData(a), accessTokenEnc: enc, accessTokenExpiresAt: expiresAt, status: "connected", lastError: null, connectedAt: new Date() },
      });
    }
    const portfolios = [...new Set(accounts.map((a) => a.business?.id).filter((id): id is string => Boolean(id)))];
    if (portfolios.length) {
      const dropped = await tx.metaAdAccount.findMany({
        where: { orgId, businessId: { in: portfolios }, accountId: { notIn: accounts.map((a) => a.id) } },
        select: { id: true, accountId: true },
      });
      if (dropped.length) {
        await tx.financeEvent.deleteMany({ where: { orgId, OR: dropped.map((d) => ({ txId: { startsWith: `meta:${d.accountId}:` } })) } });
        await tx.metaAdAccount.deleteMany({ where: { id: { in: dropped.map((d) => d.id) } } });
      }
    }
  });
  return { accounts: accounts.length };
}

/** The org's Meta Ads hub row (the channel its spend counts against), or null when not connected. */
export async function metaHub() {
  return prisma.integration.findFirst({ where: { provider: "meta_ads", status: "connected" } });
}

export const metaGraph = graph;
