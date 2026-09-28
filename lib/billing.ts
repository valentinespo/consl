/**
 * The early-access billing gate. Plain module (no "server-only") so the layout, the waiting
 * screen and any client code agree on one rule.
 *
 * A company is let into the app when it's exempt (every company that existed before early
 * access shipped, plus companies created by someone who already owns an exempt one), when
 * Stripe says its subscription is live, or when its Shopify store holds a live plan (companies
 * that came in through Shopify pay through Shopify — lib/shopify-billing). Everything else waits
 * on /pre-onboarding.
 */
/** Stripe statuses that keep the app open. past_due stays open while Stripe retries the card
 *  (its own dunning emails run meanwhile); unpaid/canceled/incomplete close it. */
export const LIVE_SUBSCRIPTION = new Set(["trialing", "active", "past_due"]);

/** The list price and the founding-member deal, for copy. */
export const LIST_PRICE_USD = 397;
export const FOUNDING_PRICE_USD = 198.5;
/** The free trial, on Stripe and on the Shopify plan alike. */
export const TRIAL_DAYS = 14;

/** Shopify plan states that keep the app open ("cancelling" runs to the end of the period). */
export const LIVE_SHOPIFY_PLAN_STATES = new Set(["trial", "active", "cancelling"]);

export function needsBillingGate(org: { billingExempt: boolean; subscriptionStatus: string | null; shopifyPlanStatus?: string | null }): boolean {
  if (org.billingExempt) return false;
  if (LIVE_SHOPIFY_PLAN_STATES.has(org.shopifyPlanStatus ?? "")) return false;
  return !LIVE_SUBSCRIPTION.has(org.subscriptionStatus ?? "");
}
