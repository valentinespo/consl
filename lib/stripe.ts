import "server-only";
import Stripe from "stripe";
import { prismaBase } from "@/lib/prisma-base";

/**
 * Stripe: one product at $397/month with a 14-day free trial; early-access companies (founding
 * members) get the 50%-off-for-life coupon applied at checkout. The company row mirrors the
 * subscription (status, trial end, period end) — written by the webhook and, belt and braces,
 * on the return from Checkout. The gate (lib/billing.ts) reads only that mirror.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID (the $397/month price),
 * STRIPE_FOUNDING_COUPON_ID (50% forever), APP_URL (absolute, for the return URLs).
 */

let client: Stripe | null = null;
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY).");
  return (client ??= new Stripe(key));
}

export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY?.trim() && !!process.env.STRIPE_PRICE_ID?.trim();

export function appUrl(): string {
  return (process.env.APP_URL?.trim() || "https://consl.ai").replace(/\/$/, "");
}

/** Mirror a Stripe subscription onto its company. Idempotent; returns the company id, or null when
 *  no company is tied to it (an unrelated subscription on the same Stripe account). */
export async function applySubscription(sub: Stripe.Subscription, orgHint?: string | null): Promise<string | null> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const orgId = orgHint ?? sub.metadata?.orgId ?? null;
  const org = await prismaBase.organization.findFirst({
    where: orgId ? { id: orgId } : { OR: [{ stripeSubscriptionId: sub.id }, { stripeCustomerId: customerId }] },
    select: { id: true, stripeSubscriptionId: true },
  });
  if (!org) return null;
  // A company that re-subscribed after cancelling: the old subscription's last events must not
  // overwrite the new one's status.
  if (org.stripeSubscriptionId && org.stripeSubscriptionId !== sub.id && sub.status === "canceled") return org.id;
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
  const periodEnd = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end ?? null;
  await prismaBase.organization.update({
    where: { id: org.id },
    data: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    },
  });
  return org.id;
}

/** On the return from Checkout: read the session straight from Stripe and mirror its subscription,
 *  so the company is let in even if the webhook is a few seconds behind. */
export async function syncCheckoutSession(sessionId: string, orgId: string): Promise<{ status: string | null }> {
  const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
  if (session.client_reference_id !== orgId) return { status: null };
  const sub = session.subscription;
  if (!sub || typeof sub === "string") return { status: null };
  await applySubscription(sub, orgId);
  return { status: sub.status };
}
