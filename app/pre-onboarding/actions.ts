"use server";

import { getCurrentOrg } from "@/lib/org";

/**
 * "Start 14-day free trial" on the waiting screen. The button is only enabled once an admin has
 * unlocked the company during the discovery call. Stripe Checkout is the next build: until it
 * lands, an unlocked company is told so plainly instead of being sent to a page that doesn't exist.
 */
export async function startTrial(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const org = await getCurrentOrg();
  if (!org) return { ok: false, error: "Sign in first." };
  if (!org.trialUnlockedAt) return { ok: false, error: "Your brand manager activates this during your call." };
  return { ok: false, error: "Checkout is being connected. Your brand manager will start your trial with you on the call." };
}
