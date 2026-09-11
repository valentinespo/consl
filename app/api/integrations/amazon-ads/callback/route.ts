import { NextResponse } from "next/server";
import { getCurrentOrgId } from "@/lib/tenant";
import { requireOwner } from "@/lib/membership";
import { verifyState, exchangeAdsCode, completeAmazonAdsConnection } from "@/lib/amazon-ads";
import { APP_ORIGIN } from "@/lib/amazon-oauth";

const back = (params: string) => NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?${params}`);

/** Amazon sends the seller back here with `code` + `state` after consenting to the Ads scope. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const amazonError = url.searchParams.get("error");
  if (amazonError) return back(`error=${encodeURIComponent(`Amazon: ${url.searchParams.get("error_description") || amazonError}`)}`);
  if (!code || !state) return back(`error=${encodeURIComponent("Missing authorization code.")}`);
  const stateOrg = verifyState(state);
  if (!stateOrg) return back(`error=${encodeURIComponent("This connection link expired — try again.")}`);
  const gate = await requireOwner();
  const currentOrg = await getCurrentOrgId();
  if (!gate.ok || currentOrg !== stateOrg) return back(`error=${encodeURIComponent("Sign in to the company you're connecting, then retry.")}`);
  try {
    const tokens = await exchangeAdsCode(code);
    await completeAmazonAdsConnection(stateOrg, tokens);
    return back("connected=amazon_ads");
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : "Connection failed.")}`);
  }
}
