import "server-only";
import { prismaBase } from "@/lib/prisma-base";
import { encryptSecret, decryptSecret } from "@/lib/secret-box";
import { makeState } from "@/lib/oauth-state";
import { APP_ORIGIN } from "@/lib/amazon-oauth";

/**
 * Xero: the accounting connection a company exports its P&L through. Standard OAuth 2.0
 * authorization-code flow (a "Web app" in Xero's developer portal). One Xero organisation per consl
 * company: Integration.sellerId = the Xero tenant id, accountName = the organisation's name.
 *
 * Tokens: an access token lasts 30 minutes; the refresh token ROTATES on every use (store the new
 * one each time) and dies after 60 days unused, so idle connections are refreshed by the scheduler
 * (xeroKeepAlive). Both are stored encrypted (Xero's security standard asks for AES).
 *
 * If the person ticks several organisations on Xero's consent screen, the connection waits in
 * status "choose" until they pick the one this company exports to; the others are disconnected
 * so they don't hold one of the app's connection slots.
 */

export const XERO_REDIRECT_URI = `${APP_ORIGIN}/api/integrations/xero/callback`;
// Apps created after 2026-03-02 only have granular scopes. accounting.settings: the organisation,
// chart of accounts (read, and create clearing accounts), tax rates, tracking categories.
// accounting.manualjournals: post the P&L as journals.
export const XERO_SCOPES = "offline_access accounting.settings accounting.manualjournals";

const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const REVOKE_URL = "https://identity.xero.com/connect/revocation";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const API_BASE = "https://api.xero.com/api.xro/2.0";
const TIMEOUT_MS = 20_000;
const REFRESH_MARGIN_MS = 5 * 60_000;
/** Refresh an idle connection well before its 60-day refresh token lapses. */
const KEEP_ALIVE_AFTER_MS = 20 * 24 * 60 * 60_000;

export class XeroError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export function xeroConfigured(): boolean {
  return Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET && process.env.INTEGRATION_ENC_KEY);
}

/** Xero's consent screen, with a signed state naming the company that started the flow. */
export function xeroConsentUrl(orgId: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: process.env.XERO_CLIENT_ID ?? "",
    redirect_uri: XERO_REDIRECT_URI,
    scope: XERO_SCOPES,
    state: makeState(orgId),
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

export type XeroTokens = { accessToken: string; refreshToken: string; expiresAt: Date; scope: string | null };

function basicAuth(): string {
  return `Basic ${Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString("base64")}`;
}

async function tokenRequest(body: Record<string, string>): Promise<XeroTokens> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = (await r.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  } | null;
  if (!r.ok || !j?.access_token || !j.refresh_token) {
    throw new XeroError(`Xero sign-in failed: ${j?.error_description ?? j?.error ?? `HTTP ${r.status}`}`, r.status);
  }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: new Date(Date.now() + (Number(j.expires_in) || 1800) * 1000),
    scope: j.scope ?? null,
  };
}

export function exchangeXeroCode(code: string): Promise<XeroTokens> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: XERO_REDIRECT_URI });
}

function tokenColumns(t: XeroTokens) {
  return {
    refreshTokenEnc: encryptSecret(t.refreshToken),
    accessTokenEnc: encryptSecret(t.accessToken),
    accessTokenExpiresAt: t.expiresAt,
    scope: t.scope,
  };
}

type XeroConn = {
  id: string;
  orgId: string | null;
  refreshTokenEnc: string | null;
  accessTokenEnc: string | null;
  accessTokenExpiresAt: Date | null;
};

const inflightRefresh = new Map<string, Promise<string>>();

/**
 * THE token source for every Xero call: the stored access token while it has 5+ minutes left,
 * otherwise one refresh per connection at a time (the refresh token rotates, so two parallel
 * refreshes would race). A refresh Xero rejects marks the connection for a reconnect.
 */
export async function xeroAccessToken(conn: XeroConn): Promise<string> {
  if (!conn.refreshTokenEnc) throw new XeroError("Xero is not connected");
  const msLeft = (conn.accessTokenExpiresAt?.getTime() ?? 0) - Date.now();
  if (conn.accessTokenEnc && msLeft > REFRESH_MARGIN_MS) return decryptSecret(conn.accessTokenEnc);

  let pending = inflightRefresh.get(conn.id);
  if (!pending) {
    pending = (async () => {
      try {
        // Always the latest refresh token: an earlier refresh may already have rotated it.
        const row = await prismaBase.integration.findUnique({ where: { id: conn.id }, select: { refreshTokenEnc: true } });
        if (!row?.refreshTokenEnc) throw new XeroError("Xero is not connected");
        const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: decryptSecret(row.refreshTokenEnc) });
        await prismaBase.integration.update({ where: { id: conn.id }, data: { ...tokenColumns(fresh), lastError: null } });
        return fresh.accessToken;
      } catch (e) {
        if (e instanceof XeroError && e.status && e.status >= 400 && e.status < 500) {
          await prismaBase.integration
            .update({ where: { id: conn.id }, data: { status: "error", lastError: `Xero sign-in expired. Reconnect Xero. (${e.message})` } })
            .catch(() => {});
        }
        throw e;
      } finally {
        inflightRefresh.delete(conn.id);
      }
    })();
    inflightRefresh.set(conn.id, pending);
  }
  return pending;
}

/** A call to the Xero Accounting API for one organisation. */
export async function xeroApi<T>(accessToken: string, tenantId: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new XeroError(`Xero ${path}: HTTP ${r.status} ${text.slice(0, 300)}`, r.status);
  }
  return (await r.json()) as T;
}

export type XeroTenant = { connectionId: string; tenantId: string; name: string; authEventId: string | null };

/** The organisations this token reaches (practices and other tenant types left out). */
export async function listXeroTenants(accessToken: string): Promise<XeroTenant[]> {
  const r = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new XeroError(`Xero connections: HTTP ${r.status}`, r.status);
  const rows = (await r.json()) as Array<{ id: string; tenantId: string; tenantType: string; tenantName: string | null; authEventId?: string | null }>;
  return rows
    .filter((c) => c.tenantType === "ORGANISATION")
    .map((c) => ({ connectionId: c.id, tenantId: c.tenantId, name: c.tenantName || "Xero organisation", authEventId: c.authEventId ?? null }));
}

/** The consent (authentication event) an access token came from, read from its own claims. */
function authEventOf(accessToken: string): string | null {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { authentication_event_id?: string };
    return claims.authentication_event_id ?? null;
  } catch {
    return null;
  }
}

/** The organisations ticked in the consent this token came from (all of them if Xero doesn't say). */
async function tenantsFromThisConsent(accessToken: string): Promise<XeroTenant[]> {
  const tenants = await listXeroTenants(accessToken);
  const event = authEventOf(accessToken);
  const fromEvent = event ? tenants.filter((t) => t.authEventId === event) : [];
  return fromEvent.length ? fromEvent : tenants;
}

async function removeXeroConnection(accessToken: string, connectionId: string): Promise<void> {
  await fetch(`${CONNECTIONS_URL}/${encodeURIComponent(connectionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((e) => console.error("[xero] could not remove an unchosen connection:", (e as Error).message));
}

/** Point the company's connection at one organisation: read its name, mark it connected. */
async function pointAtXeroOrganisation(integrationId: string, accessToken: string, tenant: XeroTenant): Promise<void> {
  const res = await xeroApi<{ Organisations?: Array<{ Name?: string; CountryCode?: string }> }>(accessToken, tenant.tenantId, "/Organisation");
  const org = res.Organisations?.[0];
  await prismaBase.integration.update({
    where: { id: integrationId },
    data: {
      status: "connected",
      sellerId: tenant.tenantId,
      accountName: org?.Name || tenant.name,
      region: org?.CountryCode ?? null,
      connectedAt: new Date(),
      lastError: null,
    },
  });
}

/**
 * Finish the consent: store the tokens, then connect the organisation that was ticked. Several
 * ticked: wait in "choose" for the person to pick one. Returns what happened.
 */
export async function completeXeroConnection(orgId: string, tokens: XeroTokens): Promise<"connected" | "choose"> {
  const tenants = await tenantsFromThisConsent(tokens.accessToken);
  if (!tenants.length) throw new Error("No Xero organisation was shared. On Xero's screen, pick the organisation for consl.");
  const row = await prismaBase.integration.upsert({
    where: { orgId_provider: { orgId, provider: "xero" } },
    create: { orgId, provider: "xero", status: "choose", ...tokenColumns(tokens), lastError: null },
    update: { status: "choose", ...tokenColumns(tokens), lastError: null },
    select: { id: true },
  });
  if (tenants.length > 1) {
    console.log(`[xero] org ${orgId}: ${tenants.length} organisations shared, waiting for a choice`);
    return "choose";
  }
  await pointAtXeroOrganisation(row.id, tokens.accessToken, tenants[0]);
  console.log(`[xero] org ${orgId} connected to Xero organisation ${tenants[0].tenantId}`);
  return "connected";
}

/** For the Integrations page: the organisations to pick from while a connection waits in "choose". */
export async function xeroChoices(orgId: string): Promise<{ tenantId: string; name: string }[]> {
  const row = await prismaBase.integration.findUnique({ where: { orgId_provider: { orgId, provider: "xero" } } });
  if (!row || row.status !== "choose") return [];
  const token = await xeroAccessToken(row);
  return (await tenantsFromThisConsent(token)).map((t) => ({ tenantId: t.tenantId, name: t.name }));
}

/** The person picked one organisation: connect it, and disconnect the others from that consent. */
export async function chooseXeroOrganisation(orgId: string, tenantId: string): Promise<void> {
  const row = await prismaBase.integration.findUnique({ where: { orgId_provider: { orgId, provider: "xero" } } });
  if (!row || row.status !== "choose") throw new Error("There's no Xero connection waiting for a choice. Connect Xero again.");
  const token = await xeroAccessToken(row);
  const tenants = await tenantsFromThisConsent(token);
  const chosen = tenants.find((t) => t.tenantId === tenantId);
  if (!chosen) throw new Error("That organisation isn't part of this Xero connection. Connect Xero again.");
  await pointAtXeroOrganisation(row.id, token, chosen);
  for (const t of tenants) if (t.tenantId !== tenantId) await removeXeroConnection(token, t.connectionId);
  console.log(`[xero] org ${orgId} chose Xero organisation ${tenantId}`);
}

/** Disconnecting: revoke the refresh token at Xero, which ends every connection it granted. */
export async function revokeXero(refreshTokenEnc: string | null): Promise<void> {
  if (!refreshTokenEnc || !xeroConfigured()) return;
  const r = await fetch(REVOKE_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: decryptSecret(refreshTokenEnc) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((e) => {
    console.error("[xero] revoke failed:", (e as Error).message);
    return null;
  });
  if (r && !r.ok) console.error(`[xero] revoke answered HTTP ${r.status}`);
}

/**
 * Refresh tokens lapse after 60 days unused: refresh every connection idle for 20+ days, so a
 * company that exports rarely never has to reconnect.
 */
export async function xeroKeepAlive(): Promise<void> {
  if (!xeroConfigured()) return;
  const idleSince = new Date(Date.now() - KEEP_ALIVE_AFTER_MS);
  const rows = await prismaBase.integration.findMany({
    where: { provider: "xero", status: "connected", accessTokenExpiresAt: { lt: idleSince } },
    select: { id: true, orgId: true, refreshTokenEnc: true, accessTokenEnc: true, accessTokenExpiresAt: true },
  });
  for (const r of rows) {
    await xeroAccessToken(r)
      .then(() => console.log(`[xero] keep-alive refreshed the connection of org ${r.orgId}`))
      .catch((e) => console.error(`[xero] keep-alive for org ${r.orgId} failed:`, (e as Error).message));
  }
}
