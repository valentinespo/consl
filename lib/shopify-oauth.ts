import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { after } from "next/server";
import { prismaBase } from "@/lib/prisma-base";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { ensureChannelFacilities } from "@/lib/integrations";
import { makeState } from "@/lib/oauth-state";
import { shopifyGraphQL, ShopifyError } from "@/lib/shopify";
import { syncShopifyLocations } from "@/lib/shopify-locations";
import { runWithOrg } from "@/lib/tenant";

/**
 * Shopify OAuth (authorization-code grant), server-only. Unlike Amazon, the flow STARTS at the
 * merchant's shop domain: we send them to https://{shop}/admin/oauth/authorize for our app, and
 * Shopify returns them to the registered callback with a one-time `code` plus an `hmac` signed
 * with the app secret. We verify our own signed `state` (org binding) AND Shopify's hmac, then
 * exchange the code for the shop's offline tokens — stored encrypted on the org's Integration row.
 *
 * Tokens EXPIRE (Shopify's rule for public apps since 2026; the Admin API answers 403 to the old
 * permanent kind): the access token lives an hour, the refresh token that mints the next one lives
 * 90 days and is renewed every time it is used. So every Admin API call gets its token through
 * shopifyAccessToken(), which refreshes when the hour is nearly up. A connection made before this
 * (Herbl's custom app) still holds a permanent token in refreshTokenEnc with no accessTokenEnc —
 * that is the legacy shape and is used as-is until the store reconnects.
 *
 * An install can also START ON SHOPIFY'S SIDE (the listing's Install button, a development store's
 * app page) with nobody signed in to consl. Shopify requires authorization to begin before any
 * sign-in, so that flow runs with a "nobody yet" state: the callback takes the token and parks it
 * (ShopifyPendingInstall, claim token in a cookie) until the person signs in or signs up, and the
 * store is then attached to their company — see the pending-install helpers at the bottom.
 */

export const APP_ORIGIN = process.env.APP_ORIGIN || "https://consl.ai";
export const SHOPIFY_REDIRECT_URI = `${APP_ORIGIN}/api/integrations/shopify/callback`;

/** Read-only v1: catalog + orders (velocity, incl. >60d history for the 90-day window) +
 *  inventory by location. Must match the scopes declared in the app's Partner-dashboard
 *  configuration when the app uses Shopify-managed installation. */
export const SHOPIFY_SCOPES =
  "read_products,read_orders,read_all_orders,read_inventory,read_locations,read_shopify_payments_accounts,read_shopify_payments_payouts,read_shopify_payments_disputes";

export function shopifyOAuthConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET && process.env.INTEGRATION_ENC_KEY);
}

/** Which Shopify app a company connects through: consl's default app, or the public-distribution
 *  app (any store can install it — reviewers' development stores included). Two apps share this
 *  host during the review period; webhooks already verify against either secret. */
export type ShopifyAppKind = "default" | "public";

export function shopifyAppCredentials(kind: ShopifyAppKind): { key: string; secret: string } {
  if (kind === "public" && process.env.SHOPIFY_PUBLIC_API_KEY && process.env.SHOPIFY_PUBLIC_API_SECRET) {
    return { key: process.env.SHOPIFY_PUBLIC_API_KEY, secret: process.env.SHOPIFY_PUBLIC_API_SECRET };
  }
  return { key: process.env.SHOPIFY_API_KEY ?? "", secret: process.env.SHOPIFY_API_SECRET ?? "" };
}

/** The app a company is set to connect through (Settings.shopifyApp = "public", else default). */
export async function shopifyAppFor(orgId: string): Promise<ShopifyAppKind> {
  const s = await prismaBase.settings.findFirst({ where: { orgId }, select: { shopifyApp: true } });
  return s?.shopifyApp === "public" ? "public" : "default";
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
/** What each app asks a store for. The private app also reads WHICH CUSTOMER placed an order (the
 *  customer id only, never a name or an email) for the lifetime-value view; a private app may
 *  always do so. The public app's list is what Shopify reviewed and stays exactly that until an
 *  update is approved — so a store connected through it simply has no customer ids. */
export function shopifyScopesFor(kind: ShopifyAppKind): string {
  return kind === "public" ? SHOPIFY_SCOPES : `${SHOPIFY_SCOPES},read_customers`;
}

export function authorizeUrl(shop: string, orgId: string, kind: ShopifyAppKind = "default"): string {
  const params = new URLSearchParams({
    client_id: shopifyAppCredentials(kind).key,
    scope: shopifyScopesFor(kind),
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
export function verifyCallbackHmac(url: URL, kind: ShopifyAppKind = "default"): boolean {
  const secret = shopifyAppCredentials(kind).secret;
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

/** What one token request returns. `refreshToken` null = Shopify issued a permanent token (the
 *  legacy kind; only custom apps still can) and `expiresAt` is then null too. */
export type ShopifyTokens = { accessToken: string; scope: string | null; expiresAt: Date | null; refreshToken: string | null };

async function tokenRequest(shop: string, body: Record<string, string>): Promise<ShopifyTokens> {
  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new ShopifyError(`Token exchange failed: ${j.error_description || j.error || r.status}`, r.status);
  }
  const expiresIn = Number(j.expires_in);
  const refreshToken = typeof j.refresh_token === "string" && j.refresh_token ? (j.refresh_token as string) : null;
  return {
    accessToken: j.access_token as string,
    scope: (j.scope as string) ?? null,
    expiresAt: refreshToken && Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
    refreshToken,
  };
}

/** Exchange the one-time code for the shop's offline tokens — the expiring kind (`expiring=1`). */
export async function exchangeShopifyCode(shop: string, code: string, kind: ShopifyAppKind = "default"): Promise<ShopifyTokens> {
  const app = shopifyAppCredentials(kind);
  return tokenRequest(shop, { client_id: app.key, client_secret: app.secret, code, expiring: "1" });
}

/** Mint the next access token (and the next refresh token) from the current refresh token. */
export async function refreshShopifyTokens(shop: string, refreshToken: string, kind: ShopifyAppKind): Promise<ShopifyTokens> {
  const app = shopifyAppCredentials(kind);
  return tokenRequest(shop, { client_id: app.key, client_secret: app.secret, grant_type: "refresh_token", refresh_token: refreshToken });
}

/** How tokens sit on an Integration row: the refresh token (or, legacy, the permanent token) in
 *  refreshTokenEnc; the hour-long access token and its expiry beside it, null for the legacy kind. */
function tokenColumns(t: ShopifyTokens) {
  return {
    refreshTokenEnc: encryptSecret(t.refreshToken ?? t.accessToken),
    accessTokenEnc: t.refreshToken ? encryptSecret(t.accessToken) : null,
    accessTokenExpiresAt: t.refreshToken ? t.expiresAt : null,
  };
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh when the hour is nearly up, never mid-request
const inflightRefresh = new Map<string, Promise<string>>();

type ShopifyConn = {
  id: string;
  orgId: string | null;
  sellerId: string | null;
  refreshTokenEnc: string | null;
  accessTokenEnc: string | null;
  accessTokenExpiresAt: Date | null;
};

/**
 * The access token to call the Admin API with, for a connected shop — THE way every Shopify call
 * gets its token. Legacy rows (permanent token, no accessTokenEnc) return it as-is; expiring rows
 * return the cached access token while it has more than a few minutes left, and otherwise mint a
 * new one from the refresh token and store the pair. Concurrent callers share one refresh.
 * A refresh Shopify rejects outright (the store uninstalled the app, or 90 days went by unused)
 * marks the connection as needing a reconnect; a network hiccup does not.
 */
export async function shopifyAccessToken(conn: ShopifyConn): Promise<string> {
  if (!conn.refreshTokenEnc || !conn.sellerId) throw new ShopifyError("Shopify is not connected");
  if (!conn.accessTokenEnc) return decryptSecret(conn.refreshTokenEnc);
  const msLeft = (conn.accessTokenExpiresAt?.getTime() ?? 0) - Date.now();
  if (msLeft > REFRESH_MARGIN_MS) return decryptSecret(conn.accessTokenEnc);

  const shop = conn.sellerId;
  const refreshTokenEnc = conn.refreshTokenEnc;
  let pending = inflightRefresh.get(conn.id);
  if (!pending) {
    pending = (async () => {
      try {
        const kind = conn.orgId ? await shopifyAppFor(conn.orgId) : "public";
        const fresh = await refreshShopifyTokens(shop, decryptSecret(refreshTokenEnc), kind);
        await prismaBase.integration.update({ where: { id: conn.id }, data: { ...tokenColumns(fresh), lastError: null } });
        return fresh.accessToken;
      } catch (e) {
        const rejected = e instanceof ShopifyError && !!e.status && e.status >= 400 && e.status < 500;
        if (rejected) {
          await prismaBase.integration
            .update({ where: { id: conn.id }, data: { status: "error", lastError: `Shopify sign-in expired — reconnect the store. (${(e as Error).message})` } })
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

/**
 * Complete a connection: prove the token works against the shop, then upsert the org's
 * Integration (encrypted token, sellerId = myshopify domain) and materialise the locked SHOP
 * facility. Unscoped client with an explicit, already-authorized orgId — same as Amazon.
 */
export async function completeShopifyConnection(orgId: string, shop: string, tokens: ShopifyTokens): Promise<void> {
  const { accessToken, scope } = tokens;
  const data = await shopifyGraphQL<{ shop: { name: string; myshopifyDomain: string; ianaTimezone: string | null } }>(
    shop,
    accessToken,
    `{ shop { name myshopifyDomain ianaTimezone } }`,
  );
  const canonical = data.shop.myshopifyDomain?.toLowerCase() || shop;
  const timezone = data.shop.ianaTimezone || null;

  await prismaBase.integration.upsert({
    where: { orgId_provider: { orgId, provider: "shopify" } },
    create: {
      orgId,
      provider: "shopify",
      status: "connected",
      ...tokenColumns(tokens),
      sellerId: canonical,
      scope,
      timezone,
      connectedAt: new Date(),
      lastError: null,
    },
    update: {
      status: "connected",
      ...tokenColumns(tokens),
      sellerId: canonical,
      scope,
      timezone,
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

/** Record the shop's reporting timezone on a connection made before we kept it (idempotent). */
export async function ensureShopifyTimezone(orgId: string): Promise<void> {
  const conn = await prismaBase.integration.findFirst({ where: { orgId, provider: "shopify", status: "connected" } });
  if (!conn?.refreshTokenEnc || !conn.sellerId || conn.timezone) return;
  const data = await shopifyGraphQL<{ shop: { ianaTimezone: string | null } }>(conn.sellerId, await shopifyAccessToken(conn), `{ shop { ianaTimezone } }`);
  if (data.shop.ianaTimezone) await prismaBase.integration.update({ where: { id: conn.id }, data: { timezone: data.shop.ianaTimezone } });
}

// ---------------------------------------------------------------------------------------------
// Installs that start on Shopify's side (nobody signed in yet)
// ---------------------------------------------------------------------------------------------

/** The `state` subject of a flow started with nobody signed in — never a real org id (cuid). */
const PENDING_STATE = "install";
export const PENDING_INSTALL_COOKIE = "so_shopify_install";
/** The cookie outlives a sign-up comfortably; the parked row a little longer (a week). */
export const PENDING_COOKIE_MAX_AGE = 60 * 60 * 24;
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SHOPIFY_CONNECTED_URL = `${APP_ORIGIN}/catalog/mapping?channel=SHOPIFY&connected=1`;

export function isPendingState(subject: string): boolean {
  return subject === PENDING_STATE;
}

/** Consent URL for an install that starts on Shopify's side: the public app (the one such installs
 *  come through), a state that says "nobody yet" — the callback parks the token. */
export function pendingAuthorizeUrl(shop: string): string {
  return authorizeUrl(shop, PENDING_STATE, "public");
}

/** Park a store's token until someone signs in: one row per shop (a second install replaces the
 *  first) and a random claim token the installing browser keeps in a cookie. Returns the token. */
export async function savePendingInstall(shop: string, tokens: ShopifyTokens): Promise<string> {
  const claimToken = randomBytes(24).toString("base64url");
  const cols = {
    accessTokenEnc: encryptSecret(tokens.accessToken),
    refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
    accessTokenExpiresAt: tokens.expiresAt,
    scope: tokens.scope,
  };
  await prismaBase.shopifyPendingInstall.upsert({
    where: { shop },
    create: { shop, ...cols, claimToken },
    update: { ...cols, claimToken },
  });
  // Installs nobody ever came back for don't accumulate.
  await prismaBase.shopifyPendingInstall
    .deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - PENDING_TTL_MS) } } })
    .catch(() => {});
  return claimToken;
}

/** The store parked for this browser, if any — the claim cookie must match a live row. */
export async function readPendingInstall(): Promise<{ shop: string; claimToken: string } | null> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(PENDING_INSTALL_COOKIE)?.value;
  } catch {
    return null; // no request context
  }
  if (!token) return null;
  const row = await prismaBase.shopifyPendingInstall.findUnique({
    where: { claimToken: token },
    select: { shop: true, claimToken: true, updatedAt: true },
  });
  if (!row || Date.now() - row.updatedAt.getTime() > PENDING_TTL_MS) return null;
  return { shop: row.shop, claimToken: row.claimToken };
}

/** A company that connected through the public app keeps connecting through it. */
export async function markOrgOnPublicApp(orgId: string): Promise<void> {
  const set = await prismaBase.settings.updateMany({ where: { orgId }, data: { shopifyApp: "public" } });
  if (set.count === 0) await prismaBase.settings.create({ data: { orgId, shopifyApp: "public" } }).catch(() => {});
}

/** History starts loading right away, in the background: every pass for this company runs now. */
export function startFirstImports(orgId: string): void {
  after(async () => {
    const { runOrgImportsNow } = await import("@/lib/scheduler");
    await runOrgImportsNow(orgId).catch((e) => console.error("[connect] first import failed:", (e as Error).message));
  });
}

/**
 * Attach the store parked for this browser to `orgId`: the same completion as a connect started
 * in consl, the company marked as connecting through the public app, the parked row gone, the
 * first imports started. Returns the shop, or null when nothing is parked. The caller decides
 * whether attaching is allowed (owner; not silently replacing another store).
 */
export async function claimPendingInstall(orgId: string): Promise<string | null> {
  const pending = await readPendingInstall();
  if (!pending) return null;
  const row = await prismaBase.shopifyPendingInstall.findUnique({ where: { claimToken: pending.claimToken } });
  if (!row) return null;
  // The parked access token may have run out while the person signed up; the refresh token is
  // what actually carries the install (parked installs always come through the public app).
  let tokens: ShopifyTokens = {
    accessToken: decryptSecret(row.accessTokenEnc),
    scope: row.scope,
    expiresAt: row.accessTokenExpiresAt,
    refreshToken: row.refreshTokenEnc ? decryptSecret(row.refreshTokenEnc) : null,
  };
  if (tokens.refreshToken && (tokens.expiresAt?.getTime() ?? 0) - Date.now() < REFRESH_MARGIN_MS) {
    tokens = await refreshShopifyTokens(row.shop, tokens.refreshToken, "public");
  }
  await completeShopifyConnection(orgId, row.shop, tokens);
  await markOrgOnPublicApp(orgId);
  await prismaBase.shopifyPendingInstall.delete({ where: { id: row.id } }).catch(() => {});
  startFirstImports(orgId);
  return row.shop;
}

/** The store `orgId` is connected to, if any (null = nothing connected). */
export async function connectedShopOf(orgId: string): Promise<string | null> {
  const row = await prismaBase.integration.findFirst({
    where: { orgId, provider: "shopify", status: "connected" },
    select: { sellerId: true },
  });
  return row?.sellerId ?? null;
}

/**
 * A brand-new company created right after an install that started on Shopify's side gets its
 * store attached without another click (the setup wizard calls this as it opens). Only when the
 * company has no store yet — an existing connection is never replaced silently.
 */
export async function attachPendingInstallToNewCompany(orgId: string): Promise<string | null> {
  const pending = await readPendingInstall();
  if (!pending) return null;
  if (await connectedShopOf(orgId)) return null;
  return claimPendingInstall(orgId);
}
