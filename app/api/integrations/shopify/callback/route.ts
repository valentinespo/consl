import { NextResponse } from "next/server";
import { getCurrentOrgId } from "@/lib/tenant";
import { requireOwner } from "@/lib/membership";
import { verifyState } from "@/lib/oauth-state";
import { normalizeShopDomain, verifyCallbackHmac, exchangeShopifyCode, completeShopifyConnection, APP_ORIGIN } from "@/lib/shopify-oauth";

const back = (params: string) => NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?${params}`);

/**
 * Shopify redirects the merchant here after consent with `code`, `shop`, `state` and an `hmac`
 * signed with our app secret. We verify our signed state (which org started the flow), verify
 * Shopify's hmac (only Shopify can produce it), confirm the signed-in owner matches that org,
 * exchange the code for the shop's offline token, and store it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const shop = normalizeShopDomain(url.searchParams.get("shop") ?? "");

  if (!code || !state || !shop) return back(`error=${encodeURIComponent("Missing authorization details from Shopify.")}`);
  if (!verifyCallbackHmac(url)) return back(`error=${encodeURIComponent("Invalid signature on the Shopify callback.")}`);

  const stateOrg = verifyState(state);
  if (!stateOrg) return back(`error=${encodeURIComponent("This connection link expired — try again.")}`);

  // The person finishing the flow must be an owner of the org it was started for.
  const gate = await requireOwner();
  const currentOrg = await getCurrentOrgId();
  if (!gate.ok || currentOrg !== stateOrg) {
    return back(`error=${encodeURIComponent("Sign in to the company you're connecting, then retry.")}`);
  }

  try {
    const { accessToken, scope } = await exchangeShopifyCode(shop, code);
    await completeShopifyConnection(stateOrg, shop, accessToken, scope);
    // Land on the mapping screen: a fresh channel's catalog is waiting to be reviewed.
    return NextResponse.redirect(`${APP_ORIGIN}/catalog/mapping?channel=SHOPIFY&connected=1`);
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : "Connection failed.")}`);
  }
}
