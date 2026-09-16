/**
 * The early-access billing gate. Plain module (no "server-only") so the layout, the waiting
 * screen and any client code agree on one rule.
 *
 * A company is let into the app when it's exempt (every company that existed before early
 * access shipped, plus companies created by someone who already owns an exempt one) or when
 * Stripe says its subscription is live. Everything else waits on /pre-onboarding.
 */
export const LIVE_SUBSCRIPTION = new Set(["trialing", "active"]);

export function needsBillingGate(org: { billingExempt: boolean; subscriptionStatus: string | null }): boolean {
  if (org.billingExempt) return false;
  return !LIVE_SUBSCRIPTION.has(org.subscriptionStatus ?? "");
}
