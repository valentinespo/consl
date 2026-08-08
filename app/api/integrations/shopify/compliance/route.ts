import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Shopify's mandatory GDPR compliance webhooks (customers/data_request, customers/redact,
 * shop/redact) — one endpoint for all three, registered three times in the app config. consl
 * stores no shopper personal data (orders are ingested as anonymous per-SKU daily unit counts),
 * so an authenticated 200 is a complete, truthful response. The HMAC check is required: Shopify
 * probes these with invalid signatures and expects a 401.
 */
export async function POST(request: Request) {
  const secret = process.env.SHOPIFY_API_SECRET;
  const given = request.headers.get("x-shopify-hmac-sha256");
  const raw = Buffer.from(await request.arrayBuffer());
  if (!secret || !given) return new NextResponse(null, { status: 401 });

  const digest = createHmac("sha256", secret).update(raw).digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(given);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new NextResponse(null, { status: 401 });

  return NextResponse.json({});
}
