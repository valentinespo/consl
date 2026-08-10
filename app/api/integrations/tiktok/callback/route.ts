import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/membership";
import { tiktokConfigured } from "@/lib/tiktok";
import { completeTikTokConnection, APP_ORIGIN } from "@/lib/tiktok-oauth";

const back = (params: string) => NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?${params}`);

/**
 * TikTok redirects the seller here after consent with ?code=TTP_…&app_key=…&shop_region=….
 * Unlike Amazon/Shopify, TikTok does NOT echo a `state` param (its authorize URL carries only our
 * service id), so there is no signed org binding to verify — instead the org is bound to the
 * signed-in OWNER completing the flow: the code is worthless without our app secret, and only an
 * owner session can turn it into a connection, for their own org alone.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) return back(`error=${encodeURIComponent("Missing authorization code from TikTok.")}`);
  if (!tiktokConfigured()) return back(`error=${encodeURIComponent("TikTok Shop connection isn't configured yet.")}`);

  // The person finishing the flow must be an owner; their current org is the one connected.
  const gate = await requireOwner();
  if (!gate.ok) return back(`error=${encodeURIComponent("Sign in to the company you're connecting, then retry.")}`);

  try {
    await completeTikTokConnection(gate.orgId, code);
    // Land on the mapping screen: a fresh channel's catalog is waiting to be reviewed.
    return NextResponse.redirect(`${APP_ORIGIN}/catalog/mapping?channel=TIKTOK&connected=1`);
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : "Connection failed.")}`);
  }
}
