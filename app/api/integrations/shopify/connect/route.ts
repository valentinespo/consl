import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/membership";
import { shopifyOAuthConfigured, normalizeShopDomain, authorizeUrl, APP_ORIGIN } from "@/lib/shopify-oauth";

const back = (msg: string) => NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?error=${encodeURIComponent(msg)}`);

/**
 * Start the Shopify connect flow. Owner-only. Takes ?shop=<something>.myshopify.com (normalised
 * from whatever the person typed) and redirects to that shop's consent page for our app; Shopify
 * returns them to /api/integrations/shopify/callback.
 */
export async function GET(request: Request) {
  const gate = await requireOwner();
  if (!gate.ok) return back("Only an owner can connect a sales channel.");
  if (!shopifyOAuthConfigured()) return back("Shopify connection isn't configured yet.");

  const raw = new URL(request.url).searchParams.get("shop") ?? "";
  const shop = normalizeShopDomain(raw);
  if (!shop) return back("Enter your store's myshopify.com domain (e.g. yourstore.myshopify.com).");

  return NextResponse.redirect(authorizeUrl(shop, gate.orgId));
}
