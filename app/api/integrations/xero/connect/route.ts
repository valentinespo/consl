import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/membership";
import { xeroConfigured, xeroConsentUrl } from "@/lib/xero";
import { APP_ORIGIN } from "@/lib/amazon-oauth";

/** Start the Xero connect flow (owner-only): off to Xero's consent screen. */
export async function GET() {
  const gate = await requireOwner();
  if (!gate.ok) return NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?error=${encodeURIComponent("Only an owner can connect Xero.")}`);
  if (!xeroConfigured()) return NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?error=${encodeURIComponent("Xero isn't configured yet.")}`);
  return NextResponse.redirect(xeroConsentUrl(gate.orgId));
}
