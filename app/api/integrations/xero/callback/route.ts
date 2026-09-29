import { NextResponse } from "next/server";
import { getCurrentOrgId } from "@/lib/tenant";
import { requireOwner } from "@/lib/membership";
import { verifyState } from "@/lib/oauth-state";
import { exchangeXeroCode, completeXeroConnection } from "@/lib/xero";
import { APP_ORIGIN } from "@/lib/amazon-oauth";

const back = (params: string) => NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?${params}`);

/**
 * Xero sends the person back here with `code` + `state` after the consent screen. Always answers
 * with a redirect (never a page), so the code in the URL can't leak through a Referer header.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorCode = url.searchParams.get("error");
  const errorText = url.searchParams.get("error_description");
  if (errorCode || errorText) {
    // Cancel on Xero's screen comes back as access_denied ("TenantConsent status DENIED").
    const declined = errorCode === "access_denied" || /denied/i.test(errorText ?? "");
    return back(`error=${encodeURIComponent(declined ? "Xero access wasn't granted." : `Xero: ${errorText || errorCode}`)}`);
  }
  if (!code || !state) return back(`error=${encodeURIComponent("Missing authorization code.")}`);
  const stateOrg = verifyState(state);
  if (!stateOrg) return back(`error=${encodeURIComponent("This connection link expired. Try again.")}`);
  const gate = await requireOwner();
  const currentOrg = await getCurrentOrgId();
  if (!gate.ok || currentOrg !== stateOrg) return back(`error=${encodeURIComponent("Sign in to the company you're connecting, then retry.")}`);
  try {
    const tokens = await exchangeXeroCode(code);
    const outcome = await completeXeroConnection(stateOrg, tokens);
    return back(outcome === "choose" ? "xero=choose" : "connected=xero");
  } catch (e) {
    console.error(`[xero] connect for org ${stateOrg} failed:`, (e as Error).message);
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : "Connection failed.")}`);
  }
}
