import { NextResponse } from "next/server";
import { getCurrentOrgId } from "@/lib/tenant";
import { requireOwner } from "@/lib/membership";
import { verifyState } from "@/lib/oauth-state";
import {
  normalizeShopDomain,
  verifyCallbackHmac,
  exchangeShopifyCode,
  completeShopifyConnection,
  shopifyAppFor,
  isPendingState,
  savePendingInstall,
  markOrgOnPublicApp,
  connectedShopOf,
  startFirstImports,
  PENDING_INSTALL_COOKIE,
  PENDING_COOKIE_MAX_AGE,
  SHOPIFY_CONNECTED_URL,
  APP_ORIGIN,
} from "@/lib/shopify-oauth";

const back = (params: string) => NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?${params}`);
const finish = (params = "") => NextResponse.redirect(`${APP_ORIGIN}/connect/shopify${params}`);

/**
 * Shopify redirects the merchant here after consent with `code`, `shop`, `state` and an `hmac`
 * signed with our app secret. We verify our signed state (which org started the flow — or that it
 * started on Shopify's side with nobody signed in), verify Shopify's hmac (only Shopify can
 * produce it), then exchange the code for the shop's offline token.
 *
 * A flow started in consl attaches the store to the org the state names (the signed-in owner must
 * match). A flow started on Shopify's side takes the token now — the code is single-use and
 * short-lived — and parks it until the person signs in or signs up; an owner who turns out to be
 * signed in already gets the store attached straight away, unless their company is connected to a
 * different store (never replaced without asking — the finish page does that).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const shop = normalizeShopDomain(url.searchParams.get("shop") ?? "");

  if (!code || !state || !shop) return back(`error=${encodeURIComponent("Missing authorization details from Shopify.")}`);

  const subject = verifyState(state);
  if (!subject) return back(`error=${encodeURIComponent("This connection link expired — try again.")}`);

  if (isPendingState(subject)) {
    if (!verifyCallbackHmac(url, "public")) return finish(`?error=${encodeURIComponent("Invalid signature on the Shopify callback.")}`);
    try {
      const tokens = await exchangeShopifyCode(shop, code, "public");
      const gate = await requireOwner();
      if (gate.ok) {
        const current = await connectedShopOf(gate.orgId);
        if (!current || current === shop) {
          await completeShopifyConnection(gate.orgId, shop, tokens);
          await markOrgOnPublicApp(gate.orgId);
          startFirstImports(gate.orgId);
          return NextResponse.redirect(SHOPIFY_CONNECTED_URL);
        }
      }
      const claimToken = await savePendingInstall(shop, tokens);
      const res = finish();
      res.cookies.set(PENDING_INSTALL_COOKIE, claimToken, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: PENDING_COOKIE_MAX_AGE,
        secure: process.env.NODE_ENV === "production",
      });
      return res;
    } catch (e) {
      return finish(`?error=${encodeURIComponent(e instanceof Error ? e.message : "Connection failed.")}`);
    }
  }

  const stateOrg = subject;
  // The signature is the app's: verify against the app this company connects through.
  const appKind = await shopifyAppFor(stateOrg);
  if (!verifyCallbackHmac(url, appKind)) return back(`error=${encodeURIComponent("Invalid signature on the Shopify callback.")}`);

  // The person finishing the flow must be an owner of the org it was started for.
  const gate = await requireOwner();
  const currentOrg = await getCurrentOrgId();
  if (!gate.ok || currentOrg !== stateOrg) {
    return back(`error=${encodeURIComponent("Sign in to the company you're connecting, then retry.")}`);
  }

  try {
    const tokens = await exchangeShopifyCode(shop, code, appKind);
    await completeShopifyConnection(stateOrg, shop, tokens);
    startFirstImports(stateOrg);
    // Land on the mapping screen: a fresh channel's catalog is waiting to be reviewed.
    return NextResponse.redirect(SHOPIFY_CONNECTED_URL);
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : "Connection failed.")}`);
  }
}
