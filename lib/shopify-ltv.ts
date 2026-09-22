import "server-only";
import { prisma } from "@/lib/prisma";
import { getOrgSettings } from "@/lib/settings";
import { shopifyGraphQL } from "@/lib/shopify";
import { shopifyAccessToken } from "@/lib/shopify-oauth";
import { importShopifyLtvHistoryPage } from "@/lib/orders";
import { LTV_FACTS_VERSION } from "@/lib/ltv-shopify";

export type LtvSyncState = {
  factsVersion: number;
  shop: string;
  startedAt: string;
  cursor: string | null;
  completedAt: string | null;
  orders: number;
  error: string | null;
  lastAttemptAt: string;
  historyAccess: boolean;
};
export function readLtvSyncState(value: unknown): LtvSyncState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as LtvSyncState;
  return typeof v.shop === "string" && typeof v.startedAt === "string" && typeof v.orders === "number" ? v : null;
}

/** Refresh GRANTED scopes, not the OAuth request's stale stored string. A custom app may have
 * been granted customer access since installation. Public apps only run after that access is
 * actually granted by Shopify. No scope is added to either app configuration here. */
export async function syncShopifyLtvHistory(): Promise<{ done: boolean; orders: number; error?: string }> {
  const conn = await prisma.integration.findFirst({ where: { provider: "shopify", status: "connected" } });
  if (!conn?.sellerId || !conn.refreshTokenEnc) return { done: false, orders: 0, error: "Connect Shopify to measure customer lifetime value." };
  const settings = await getOrgSettings();
  let state = readLtvSyncState(settings.shopifyLtvState);
  if (state?.shop !== conn.sellerId || state?.factsVersion !== LTV_FACTS_VERSION) state = null;
  if (state?.completedAt && state.historyAccess) return { done: true, orders: state.orders };
  if (state?.lastAttemptAt && Date.now() - Date.parse(state.lastAttemptAt) < (state.error ? 15 * 60_000 : 45_000)) return { done: false, orders: state.orders };
  const lease = new Date(Date.now() + 5 * 60_000);
  const claimed = await prisma.settings.updateMany({
    where: { id: settings.id, OR: [{ shopifyLtvLeaseUntil: null }, { shopifyLtvLeaseUntil: { lt: new Date() } }] },
    data: { shopifyLtvLeaseUntil: lease },
  });
  if (!claimed.count) return { done: false, orders: state?.orders ?? 0 };
  const now = new Date().toISOString();
  state ??= { factsVersion: LTV_FACTS_VERSION, shop: conn.sellerId, startedAt: now, cursor: null, completedAt: null, orders: 0, error: null, lastAttemptAt: now, historyAccess: false };
  state.lastAttemptAt = now;
  const save = () => prisma.settings.update({ where: { id: settings.id }, data: { shopifyLtvState: state! } });
  try {
    const token = await shopifyAccessToken(conn);
    const access = await shopifyGraphQL<{ currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>(conn.sellerId, token, `query LtvAccess { currentAppInstallation { accessScopes { handle } } }`);
    const scopes = access.currentAppInstallation.accessScopes.map((s) => s.handle);
    await prisma.integration.update({ where: { id: conn.id }, data: { scope: scopes.join(",") } });
    if (!scopes.includes("read_customers")) throw new Error("This Shopify connection needs customer access. Grant read_customers to the custom app, or reconnect after the public app is approved for it.");
    if (!scopes.includes("read_all_orders")) throw new Error("Full order-history access is required to identify first purchases. Grant read_all_orders; preparation will resume automatically.");
    state.historyAccess = true;
    state.error = null;
    await save();
    // Small durable steps resume after a restart, rate limit, or a failed page. Never mark a
    // capped import complete. Live orders continue through the usual webhooks/updated_at poll.
    for (let page = 0; page < 5 && Date.now() < lease.getTime() - 60_000; page++) {
      const result = await importShopifyLtvHistoryPage(state.cursor, state.startedAt);
      state.orders += result.orders;
      state.cursor = result.endCursor;
      if (!result.hasNextPage) state.completedAt = new Date().toISOString();
      await save();
      if (state.completedAt) break;
    }
    return { done: !!state.completedAt, orders: state.orders };
  } catch (error) {
    // Keep the last successful cursor. The worker retries automatically after the backoff.
    const message = error instanceof Error ? error.message : "Shopify history could not be imported.";
    state.error = /access|read_customers|read_all_orders|could not be saved|incomplete history/i.test(message) ? message.slice(0, 300) : "Shopify couldn’t finish this history check. We’ll retry automatically and continue from the last saved point.";
    await save();
    console.error("[shopify LTV]", message);
    return { done: false, orders: state.orders, error: state.error };
  } finally {
    await prisma.settings.updateMany({ where: { id: settings.id, shopifyLtvLeaseUntil: lease }, data: { shopifyLtvLeaseUntil: null } });
  }
}
