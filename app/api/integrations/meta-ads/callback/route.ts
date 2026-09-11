import { NextResponse, after } from "next/server";
import { getCurrentOrgId, runWithOrg } from "@/lib/tenant";
import { requireOwner } from "@/lib/membership";
import { verifyState, exchangeMetaCode, completeMetaAdsConnection } from "@/lib/meta-ads";
import { importMetaAdsSpend } from "@/lib/meta-ads-spend";
import { APP_ORIGIN } from "@/lib/amazon-oauth";

const back = (params: string) => NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?${params}`);

/** Meta sends the person back here with `code` + `state` after they grant access. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const metaError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (metaError) return back(`error=${encodeURIComponent(`Meta: ${metaError}`)}`);
  if (!code || !state) return back(`error=${encodeURIComponent("Missing authorization code.")}`);
  const stateOrg = verifyState(state);
  if (!stateOrg) return back(`error=${encodeURIComponent("This connection link expired — try again.")}`);
  const gate = await requireOwner();
  const currentOrg = await getCurrentOrgId();
  if (!gate.ok || currentOrg !== stateOrg) return back(`error=${encodeURIComponent("Sign in to the company you're connecting, then retry.")}`);
  try {
    const token = await exchangeMetaCode(code);
    await completeMetaAdsConnection(stateOrg, token);
    // The first read starts as soon as the person is back on the page, so the P&L shows the
    // spend within minutes instead of at the scheduler's next six-hour pass.
    after(() =>
      runWithOrg(stateOrg, () => importMetaAdsSpend()).catch((e) => console.error(`[meta ads] first import for ${stateOrg} failed:`, (e as Error).message)),
    );
    return back("connected=meta_ads");
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : "Connection failed.")}`);
  }
}
