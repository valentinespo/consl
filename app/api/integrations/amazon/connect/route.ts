import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/membership";
import { amazonOAuthConfigured, consentUrl, APP_ORIGIN } from "@/lib/amazon-oauth";

/**
 * Start the Amazon connect flow. Owner-only. Redirects the seller to Amazon's consent page; Amazon
 * returns them to /api/integrations/amazon/callback. GET so a plain link/button navigates to it.
 */
export async function GET() {
  const gate = await requireOwner();
  if (!gate.ok) {
    return NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?error=${encodeURIComponent("Only an owner can connect a sales channel.")}`);
  }
  if (!amazonOAuthConfigured()) {
    return NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?error=${encodeURIComponent("Amazon connection isn't configured yet.")}`);
  }
  return NextResponse.redirect(consentUrl(gate.orgId));
}
