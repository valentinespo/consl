"use server";

import { requireOwner } from "@/lib/membership";
import { prismaBase } from "@/lib/prisma-base";
import { appUrl, stripe, stripeConfigured } from "@/lib/stripe";

/** Stripe's customer portal: update the card, see invoices, cancel. Owners only. */
export async function openBillingPortal(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const gate = await requireOwner();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!stripeConfigured()) return { ok: false, error: "Billing isn't connected yet." };
  const org = await prismaBase.organization.findUnique({ where: { id: gate.orgId }, select: { stripeCustomerId: true } });
  if (!org?.stripeCustomerId) return { ok: false, error: "This company has no billing account yet." };
  try {
    const session = await stripe().billingPortal.sessions.create({ customer: org.stripeCustomerId, return_url: `${appUrl()}/settings/billing` });
    return { ok: true, url: session.url };
  } catch (e) {
    console.error("[stripe] portal session failed:", (e as Error).message);
    return { ok: false, error: "Couldn't open the billing portal. Try again in a moment." };
  }
}
