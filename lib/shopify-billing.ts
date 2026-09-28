import "server-only";
import { prismaBase } from "@/lib/prisma-base";
import { shopifyGraphQL } from "@/lib/shopify";
import { shopifyAccessToken, shopifyAppFor, attachPendingInstallToNewCompany } from "@/lib/shopify-oauth";

/**
 * Shopify App Pricing — how a company that came in through Shopify pays for consl.
 *
 * Who pays where: a company that signed up on consl.ai pays by card through Stripe, and keeps doing
 * so when it connects its Shopify store (Shopify only asks that merchants who install consl from
 * Shopify can pay through Shopify). A company that started from a Shopify install, with no Stripe
 * subscription, picks its plan on Shopify's own plan page instead; the charge lands on its Shopify
 * bill. The plan itself (price, trial) lives in the Partner Dashboard, not in code.
 *
 * Shopify stopped sending plan-change webhooks for App Pricing (April 2026): the plan is read from
 * the Partner API `activeSubscription` — on return from the plan page, when the waiting screen or
 * the billing page opens, and every few hours from the scheduler. An uninstall still arrives as a
 * webhook (app/uninstalled) and clears the plan at once.
 *
 * Development stores are never charged: Shopify gives them paid plans at no charge for testing.
 * Such a plan still opens consl (it is how Shopify's reviewers test billing) but is flagged
 * (shopifyPlanTest) so the internal admin can see it.
 */

const PARTNER_API_VERSION = "2026-07";

export function shopifyBillingConfigured(): boolean {
  return Boolean(
    process.env.SHOPIFY_PARTNER_ORG_ID && process.env.SHOPIFY_PARTNER_API_TOKEN && process.env.SHOPIFY_PUBLIC_APP_ID && process.env.SHOPIFY_APP_HANDLE,
  );
}

/** Shopify's hosted plan page for a store: where the merchant picks, changes or cancels the plan. */
export function shopifyPlanPageUrl(shop: string): string | null {
  const handle = process.env.SHOPIFY_APP_HANDLE;
  if (!handle) return null;
  const store = shop.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${encodeURIComponent(store)}/charges/${encodeURIComponent(handle)}/pricing_plans`;
}

type ActiveSubscription = {
  cancelAtEndOfCycle: boolean | null;
  trialEndsAt: string | null;
  currentBillingCycle: { startTime: string; endTime: string } | null;
  items: Array<{ handle: string | null; price: { __typename: string; amount?: string | null } | null }>;
} | null;

async function partnerGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const org = process.env.SHOPIFY_PARTNER_ORG_ID;
  const r = await fetch(`https://partners.shopify.com/${org}/api/${PARTNER_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": process.env.SHOPIFY_PARTNER_API_TOKEN ?? "" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => null)) as { data?: T; errors?: Array<{ message?: string }> } | null;
  if (!r.ok || !j || j.errors?.length) throw new Error(`Shopify Partner API: ${j?.errors?.[0]?.message ?? `HTTP ${r.status}`}`);
  return j.data as T;
}

const ACTIVE_SUBSCRIPTION = `query ActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    cancelAtEndOfCycle
    trialEndsAt
    currentBillingCycle { startTime endTime }
    items { handle price { __typename ... on FlatRatePrice { amount } } }
  }
}`;

/** The plan in consl's words: trial / active / cancelling, or null for no plan. */
function planStatus(sub: ActiveSubscription): string | null {
  if (!sub) return null;
  if (sub.trialEndsAt && new Date(sub.trialEndsAt).getTime() > Date.now()) return "trial";
  if (sub.cancelAtEndOfCycle) return "cancelling";
  return "active";
}

/** The company's Shopify store when it connects through the public app (the one App Pricing covers). */
async function publicStoreOf(orgId: string) {
  if ((await shopifyAppFor(orgId)) !== "public") return null;
  return prismaBase.integration.findFirst({ where: { orgId, provider: "shopify" }, orderBy: { updatedAt: "desc" } });
}

/**
 * Ask Shopify which plan the company's store holds and mirror it on the company. Returns the plan
 * status (null = none), or undefined when there is nothing to ask (not configured, not on the public
 * app, no store). A failed call leaves the last known state untouched.
 */
export async function syncShopifyBilling(orgId: string): Promise<string | null | undefined> {
  if (!shopifyBillingConfigured()) return undefined;
  const conn = await publicStoreOf(orgId);
  if (!conn?.sellerId) return undefined;
  const org = await prismaBase.organization.findUnique({
    where: { id: orgId },
    select: { shopifyShopGid: true, shopifyShopDomain: true, shopifyPlanTest: true },
  });

  // Everything on record belongs to one store. A company now connected to a different store starts
  // afresh: the old store's plan never carries over (Shopify plans belong to the store).
  const sameStore = org?.shopifyShopDomain === conn.sellerId;
  let shopGid = sameStore ? (org?.shopifyShopGid ?? null) : null;
  let test = sameStore ? (org?.shopifyPlanTest ?? false) : false;

  // The store's Shopify id, once: after that the check never depends on the store's token.
  if (!shopGid && conn.status === "connected") {
    const token = await shopifyAccessToken(conn);
    const d = await shopifyGraphQL<{ shop: { id: string; plan: { partnerDevelopment: boolean } | null } }>(
      conn.sellerId,
      token,
      `{ shop { id plan { partnerDevelopment } } }`,
    );
    shopGid = d.shop.id;
    test = !!d.shop.plan?.partnerDevelopment;
  }
  if (!shopGid) {
    // A new store Shopify can't be asked about yet (not connected): drop the old store's plan.
    if (!sameStore) {
      await prismaBase.organization.update({
        where: { id: orgId },
        data: {
          shopifyShopGid: null,
          shopifyShopDomain: conn.sellerId,
          shopifyPlanTest: false,
          shopifyPlanStatus: null,
          shopifyPlanHandle: null,
          shopifyPlanPrice: null,
          shopifyTrialEndsAt: null,
          shopifyPeriodEnd: null,
          shopifyBillingAt: new Date(),
        },
      });
      return null;
    }
    return undefined;
  }

  // A store that uninstalled consl holds no plan (Shopify cancels it with the uninstall).
  const sub =
    conn.status === "connected" || conn.status === "error"
      ? (await partnerGraphQL<{ activeSubscription: ActiveSubscription }>(ACTIVE_SUBSCRIPTION, { appId: `gid://shopify/App/${process.env.SHOPIFY_PUBLIC_APP_ID}`, shopId: shopGid })).activeSubscription
      : null;
  const status = planStatus(sub);
  const item = sub?.items?.[0] ?? null;
  const price = item?.price && "amount" in item.price && item.price.amount != null ? Number(item.price.amount) : null;
  await prismaBase.organization.update({
    where: { id: orgId },
    data: {
      shopifyShopGid: shopGid,
      shopifyShopDomain: conn.sellerId,
      shopifyPlanTest: test,
      shopifyPlanStatus: status,
      // The last plan the store held stays on record after a lapse: it tells a first choice from a
      // comeback. A different store has no history.
      shopifyPlanHandle: status ? (item?.handle ?? null) : sameStore ? undefined : null,
      shopifyPlanPrice: status ? price : null,
      shopifyTrialEndsAt: sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null,
      shopifyPeriodEnd: sub?.currentBillingCycle?.endTime ? new Date(sub.currentBillingCycle.endTime) : null,
      shopifyBillingAt: new Date(),
    },
  });
  return status;
}

/** An uninstall: the store's plan ends with it (Shopify cancels app charges on uninstall). */
export async function clearShopifyPlan(orgId: string): Promise<void> {
  await prismaBase.organization.update({
    where: { id: orgId },
    data: { shopifyPlanStatus: null, shopifyPlanPrice: null, shopifyTrialEndsAt: null, shopifyPeriodEnd: null, shopifyBillingAt: new Date() },
  });
}

/**
 * The company's billing page shows Shopify billing whenever the company isn't on Stripe and its
 * store connects through the public app: that plan lives in Shopify. Refreshes the plan when the
 * last check is more than ten minutes old, or belongs to another store.
 */
export async function shopifyBillingView(orgId: string): Promise<{ shop: string; planUrl: string | null; installed: boolean } | null> {
  const org = await prismaBase.organization.findUnique({
    where: { id: orgId },
    select: { stripeSubscriptionId: true, shopifyShopDomain: true, shopifyBillingAt: true },
  });
  if (!org || org.stripeSubscriptionId) return null;
  const conn = await publicStoreOf(orgId);
  if (!conn?.sellerId) return null;
  if (!org.shopifyBillingAt || Date.now() - org.shopifyBillingAt.getTime() > 10 * 60_000 || org.shopifyShopDomain !== conn.sellerId) {
    await syncShopifyBilling(orgId).catch((e) => console.error(`[shopify billing] check failed for ${orgId}:`, (e as Error).message));
  }
  return { shop: conn.sellerId, planUrl: shopifyPlanPageUrl(conn.sellerId), installed: conn.status === "connected" || conn.status === "error" };
}

export type ShopifyBillingPath = {
  shop: string;
  planUrl: string | null;
  /** consl is still installed on the store (false after an uninstall: reinstall first). */
  installed: boolean;
  /** The company had a Shopify plan before (so this is a lapse, not a first choice). */
  lapsed: boolean;
};

/**
 * Whether a company waiting at the billing gate pays through Shopify, and where to send it. A
 * company that ever had a Stripe subscription stays on Stripe. One that started from a Shopify
 * install (the store parked in this browser, or already attached through the public app) pays
 * through Shopify. Everything else is the early-access path (demo call, then card).
 */
export async function shopifyBillingPath(orgId: string): Promise<ShopifyBillingPath | null> {
  const org = await prismaBase.organization.findUnique({
    where: { id: orgId },
    select: { stripeSubscriptionId: true, shopifyPlanHandle: true, shopifyPlanStatus: true, shopifyShopDomain: true },
  });
  if (!org || org.stripeSubscriptionId) return null;
  // An install that started on Shopify and hasn't been attached yet: attach it now, so the plan the
  // merchant picks can be matched back to this company.
  await attachPendingInstallToNewCompany(orgId).catch((e) => console.error("[shopify billing] attach failed:", (e as Error).message));
  const conn = await publicStoreOf(orgId);
  if (!conn?.sellerId) return null;
  return {
    shop: conn.sellerId,
    planUrl: shopifyPlanPageUrl(conn.sellerId),
    installed: conn.status === "connected" || conn.status === "error",
    lapsed: !org.shopifyPlanStatus && !!org.shopifyPlanHandle && org.shopifyShopDomain === conn.sellerId,
  };
}
