import { NextResponse } from "next/server";
import { prismaBase } from "@/lib/prisma-base";
import { normalizeShopDomain, APP_ORIGIN } from "@/lib/shopify-oauth";
import { syncShopifyBilling } from "@/lib/shopify-billing";

export const dynamic = "force-dynamic";

/**
 * The plan's welcome link: where Shopify sends a merchant after they pick, change or cancel the
 * consl plan on Shopify's plan page. Shopify appends ?plan_handle=…&shop=…; the plan itself is read
 * back from Shopify for every company attached to that store (never taken from the URL), then the
 * person carries on into consl — the gate opens as soon as the plan is live.
 */
export async function GET(request: Request) {
  const shop = normalizeShopDomain(new URL(request.url).searchParams.get("shop") ?? "");
  if (shop) {
    const conns = await prismaBase.integration.findMany({ where: { provider: "shopify", sellerId: shop }, select: { orgId: true } });
    for (const c of conns) {
      if (!c.orgId) continue;
      await syncShopifyBilling(c.orgId).catch((e) => console.error(`[shopify billing] return sync failed for ${c.orgId}:`, (e as Error).message));
    }
  }
  return NextResponse.redirect(`${APP_ORIGIN}/`);
}
