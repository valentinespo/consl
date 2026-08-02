import { NextResponse } from "next/server";
import { getCurrentOrgId } from "@/lib/tenant";
import { requireOwner } from "@/lib/membership";
import { verifyState, exchangeCode, completeAmazonConnection, APP_ORIGIN } from "@/lib/amazon-oauth";

const back = (params: string) => NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?${params}`);

/**
 * Amazon redirects the seller here after consent with `spapi_oauth_code`, `state`, and
 * `selling_partner_id`. We verify the signed state, confirm the signed-in owner matches the org
 * the flow was started for, exchange the code for the seller's refresh token, and store it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("spapi_oauth_code");
  const state = url.searchParams.get("state");
  const sellerId = url.searchParams.get("selling_partner_id");
  const amazonError = url.searchParams.get("error");

  if (amazonError) return back(`error=${encodeURIComponent(`Amazon: ${amazonError}`)}`);
  if (!code || !state) return back(`error=${encodeURIComponent("Missing authorization code.")}`);

  const stateOrg = verifyState(state);
  if (!stateOrg) return back(`error=${encodeURIComponent("This connection link expired — try again.")}`);

  // The person finishing the flow must be an owner of the org it was started for (not just anyone
  // holding the redirect URL).
  const gate = await requireOwner();
  const currentOrg = await getCurrentOrgId();
  if (!gate.ok || currentOrg !== stateOrg) {
    return back(`error=${encodeURIComponent("Sign in to the company you're connecting, then retry.")}`);
  }

  try {
    const refreshToken = await exchangeCode(code);
    await completeAmazonConnection(stateOrg, refreshToken, sellerId);
    return back("connected=amazon");
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : "Connection failed.")}`);
  }
}
