import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/current-user";
import { getCurrentOrgId } from "@/lib/tenant";
import { requireOwner } from "@/lib/membership";
import {
  readPendingInstall,
  claimPendingInstall,
  connectedShopOf,
  PENDING_INSTALL_COOKIE,
  SHOPIFY_CONNECTED_URL,
  APP_ORIGIN,
} from "@/lib/shopify-oauth";

const finish = (params = "") => NextResponse.redirect(`${APP_ORIGIN}/connect/shopify${params}`);

/**
 * Attach the store parked for this browser (an install that started on Shopify's side) to the
 * signed-in owner's company. This is where sign-in and sign-up send the person back to.
 *
 * Signed out → sign in first (the middleware does that). No company yet → create one; the setup
 * wizard attaches the store as it opens. A company already connected to a DIFFERENT store is
 * never switched silently: the finish page explains and asks, and comes back with ?replace=1.
 */
export async function GET(request: Request) {
  const pending = await readPendingInstall();
  if (!pending) return finish(); // nothing parked (already attached, or expired) — the page says so

  if (!(await currentUserId())) {
    return NextResponse.redirect(`${APP_ORIGIN}/sign-in?redirect_url=${encodeURIComponent("/api/integrations/shopify/claim")}`);
  }
  const orgId = await getCurrentOrgId();
  if (!orgId) return NextResponse.redirect(`${APP_ORIGIN}/welcome`);

  const gate = await requireOwner();
  if (!gate.ok) return finish(); // the page explains that only an owner can attach a store

  const current = await connectedShopOf(orgId);
  const replace = new URL(request.url).searchParams.get("replace") === "1";
  if (current && current !== pending.shop && !replace) return finish();

  try {
    await claimPendingInstall(orgId);
    const res = NextResponse.redirect(SHOPIFY_CONNECTED_URL);
    res.cookies.delete(PENDING_INSTALL_COOKIE);
    return res;
  } catch (e) {
    return finish(`?error=${encodeURIComponent(e instanceof Error ? e.message : "Connection failed.")}`);
  }
}
