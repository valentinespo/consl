import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/membership";
import { amazonAdsConfigured, adsConsentUrl } from "@/lib/amazon-ads";
import { APP_ORIGIN } from "@/lib/amazon-oauth";

/** Start the Amazon Ads connect flow (owner-only): off to Amazon's consent page. */
export async function GET() {
  const gate = await requireOwner();
  if (!gate.ok) return NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?error=${encodeURIComponent("Only an owner can connect Amazon Ads.")}`);
  if (!amazonAdsConfigured()) return NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?error=${encodeURIComponent("Amazon Ads isn't configured yet.")}`);
  return NextResponse.redirect(adsConsentUrl(gate.orgId));
}
