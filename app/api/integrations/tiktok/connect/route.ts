import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/membership";
import { tiktokConfigured } from "@/lib/tiktok";
import { APP_ORIGIN } from "@/lib/tiktok-oauth";

const back = (msg: string) => NextResponse.redirect(`${APP_ORIGIN}/settings/integrations?error=${encodeURIComponent(msg)}`);

/**
 * Start the TikTok Shop connect flow. Owner-only. Unlike Shopify there's nothing to collect first:
 * a custom app has one fixed authorization page (keyed by its service id), and TikTok returns the
 * seller to /api/integrations/tiktok/callback after consent.
 */
export async function GET() {
  const gate = await requireOwner();
  if (!gate.ok) return back("Only an owner can connect a sales channel.");
  if (!tiktokConfigured()) return back("TikTok Shop connection isn't configured yet.");

  const serviceId = process.env.TIKTOK_SERVICE_ID ?? "7671534619103135501";
  return NextResponse.redirect(`https://services.tiktokshop.com/open/authorize?service_id=${serviceId}`);
}
