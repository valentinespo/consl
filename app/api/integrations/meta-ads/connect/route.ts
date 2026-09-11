import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/membership";
import { metaAdsConfigured, metaConsentUrl } from "@/lib/meta-ads";
import { APP_ORIGIN } from "@/lib/amazon-oauth";

/** Start the Meta Ads connect flow (owner-only): off to Meta's login dialog. */
export async function GET() {
  const gate = await requireOwner();
  if (!gate.ok) return NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?error=${encodeURIComponent("Only an owner can connect Meta Ads.")}`);
  if (!metaAdsConfigured()) return NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?error=${encodeURIComponent("Meta Ads isn't configured yet.")}`);
  return NextResponse.redirect(metaConsentUrl(gate.orgId));
}
