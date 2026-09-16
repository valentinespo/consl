import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { applySubscription, stripe } from "@/lib/stripe";

/**
 * Stripe → consl. Every event is verified against the endpoint's signing secret; the ones that
 * matter mirror the subscription onto the company row (status, trial end, period end). Anything
 * else is acknowledged and ignored. Idempotent by construction: each handled event re-reads the
 * subscription's current state rather than applying a delta.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return new NextResponse("Missing signature", { status: 400 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, secret);
  } catch (e) {
    return new NextResponse(`Invalid signature: ${(e as Error).message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (session.mode === "subscription" && subId) {
          const sub = await stripe().subscriptions.retrieve(subId);
          await applySubscription(sub, session.client_reference_id ?? session.metadata?.orgId ?? null);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.trial_will_end":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        await applySubscription(event.data.object);
        break;
      }
      case "invoice.paid":
      case "invoice.payment_failed": {
        // The subscription's status carries the outcome; re-read it so the mirror can't lag.
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null; parent?: { subscription_details?: { subscription?: string | Stripe.Subscription | null } | null } | null };
        const ref = invoice.parent?.subscription_details?.subscription ?? invoice.subscription ?? null;
        const subId = typeof ref === "string" ? ref : ref?.id;
        if (subId) await applySubscription(await stripe().subscriptions.retrieve(subId));
        break;
      }
      default:
        break;
    }
  } catch (e) {
    // A 500 makes Stripe retry — the right thing when our side hiccups.
    console.error(`[stripe] ${event.type} failed:`, (e as Error).message);
    return new NextResponse("Handler failed", { status: 500 });
  }
  return NextResponse.json({ received: true });
}
