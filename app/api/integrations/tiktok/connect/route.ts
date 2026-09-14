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

  // A US-region app authorizes on TikTok's US service host — the same link Partner Center hands
  // out under "Copy authorization link". Override for another region's app.
  const serviceId = process.env.TIKTOK_SERVICE_ID ?? "7671534619103135501";
  const authOrigin = process.env.TIKTOK_AUTH_ORIGIN || "https://services.tiktokshops.us";
  return NextResponse.redirect(`${authOrigin}/open/authorize?service_id=${serviceId}`);
}
