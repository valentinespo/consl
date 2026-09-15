import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/current-user";
import { getCurrentOrgId } from "@/lib/tenant";
import { requireOwner } from "@/lib/membership";
import {
  shopifyOAuthConfigured,
  normalizeShopDomain,
  authorizeUrl,
  pendingAuthorizeUrl,
  connectedShopOf,
  shopifyAppFor,
  APP_ORIGIN,
} from "@/lib/shopify-oauth";

const back = (msg: string) => NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?error=${encodeURIComponent(msg)}`);

/**
 * Start the Shopify connect flow. Takes ?shop=<something>.myshopify.com (normalised from whatever
 * the person typed, or exactly what Shopify appends when an install starts on its side) and sends
 * the store to its consent page for our app; Shopify returns it to /api/integrations/shopify/callback.
 *
 * Two ways in:
 *  - From consl (Integrations → Connect): an owner, signed in. The state binds the flow to their
 *    company and the callback attaches the store to it.
 *  - From Shopify (the listing's Install button, a development store's app page, the app opened
 *    from a store's admin) with nobody signed in. Shopify requires authorization to start
 *    immediately, so the flow runs with a "nobody yet" state; the callback parks the token and the
 *    person signs in or signs up afterwards to attach it (/api/integrations/shopify/claim).
 */
export async function GET(request: Request) {
  if (!shopifyOAuthConfigured()) return back("Shopify connection isn't configured yet.");

  const raw = new URL(request.url).searchParams.get("shop") ?? "";
  const shop = normalizeShopDomain(raw);
  if (!shop) return back("Enter your store's myshopify.com domain (e.g. yourstore.myshopify.com).");

  // Nobody signed in, or signed in without a company yet: authorize now, attach after sign-in.
  const userId = await currentUserId();
  const orgId = userId ? await getCurrentOrgId() : null;
  if (!userId || !orgId) return NextResponse.redirect(pendingAuthorizeUrl(shop));

  const gate = await requireOwner();
  if (!gate.ok) return back("Only an owner can connect a sales channel.");

  // Opening an already-connected store from its Shopify admin lands here too: nothing to redo.
  if ((await connectedShopOf(gate.orgId)) === shop) return NextResponse.redirect(`${APP_ORIGIN}/`);

  return NextResponse.redirect(authorizeUrl(shop, gate.orgId, await shopifyAppFor(gate.orgId)));
}
