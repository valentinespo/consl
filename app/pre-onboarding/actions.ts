"use server";

import { getCurrentOrg } from "@/lib/org";
import { currentUserId } from "@/lib/current-user";
import { needsBillingGate } from "@/lib/billing";
import { prismaBase } from "@/lib/prisma-base";
import { appUrl, stripe, stripeConfigured } from "@/lib/stripe";

/**
 * "Start 14-day free trial" on the waiting screen. The button is only enabled once an admin has
 * unlocked the company during the discovery call. It opens Stripe Checkout for the $397/month
 * plan with a 14-day trial; a founding member's 50%-off-for-life coupon is applied on the way in.
 * The card is collected up front so the trial rolls into a paid subscription on its own.
 */
export async function startTrial(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const org = await getCurrentOrg();
  if (!org) return { ok: false, error: "Sign in first." };
  if (!org.trialUnlockedAt) return { ok: false, error: "Your brand manager activates this during your call." };
  if (!needsBillingGate(org)) return { ok: true, url: "/" };
  if (!stripeConfigured()) return { ok: false, error: "Checkout isn't connected yet. Your brand manager will start your trial with you on the call." };

  const userId = await currentUserId();
  const app = await prismaBase.accessApplication.findFirst({ where: { orgId: org.id }, orderBy: { createdAt: "desc" }, select: { email: true } });
  const row = await prismaBase.organization.findUnique({ where: { id: org.id }, select: { stripeCustomerId: true, foundingMember: true } });
  const coupon = process.env.STRIPE_FOUNDING_COUPON_ID?.trim();
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      client_reference_id: org.id,
      ...(row?.stripeCustomerId ? { customer: row.stripeCustomerId } : { customer_email: app?.email ?? org.email ?? undefined }),
      line_items: [{ price: process.env.STRIPE_PRICE_ID!.trim(), quantity: 1 }],
      ...(row?.foundingMember && coupon ? { discounts: [{ coupon }] } : { allow_promotion_codes: true }),
      payment_method_collection: "always",
      subscription_data: {
        trial_period_days: 14,
        metadata: { orgId: org.id, orgName: org.name, clerkUserId: userId ?? "" },
      },
      metadata: { orgId: org.id },
      success_url: `${appUrl()}/pre-onboarding?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/pre-onboarding?checkout=cancelled`,
    });
    if (!session.url) return { ok: false, error: "Stripe didn't return a checkout page. Try again in a moment." };
    return { ok: true, url: session.url };
  } catch (e) {
    console.error("[stripe] checkout session failed:", (e as Error).message);
    return { ok: false, error: "Couldn't open checkout. Try again in a moment." };
  }
}
