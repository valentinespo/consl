import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Shopify's mandatory GDPR compliance webhooks (customers/data_request, customers/redact,
 * shop/redact) — one endpoint for all three, registered three times in the app config. consl
 * stores no shopper personal data (orders are ingested as anonymous per-SKU daily unit counts),
 * so an authenticated 200 is a complete, truthful response. The HMAC check is required: Shopify
 * probes these with invalid signatures and expects a 401, and with valid ones expecting a 200.
 *
 * Two Shopify apps may point their compliance hooks at this host at once (Herbl's custom app and
 * the public app under review), each signing with its own client secret — so a signature from
 * either SHOPIFY_API_SECRET or SHOPIFY_API_SECRET_ALT is accepted.
 */
export async function POST(request: Request) {
  const secrets = [process.env.SHOPIFY_API_SECRET, process.env.SHOPIFY_API_SECRET_ALT].filter(
    (s): s is string => Boolean(s),
  );
  const given = request.headers.get("x-shopify-hmac-sha256");
  const raw = Buffer.from(await request.arrayBuffer());
  if (!secrets.length || !given) return new NextResponse(null, { status: 401 });

  const b = Buffer.from(given);
  const ok = secrets.some((secret) => {
    const a = Buffer.from(createHmac("sha256", secret).update(raw).digest("base64"));
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!ok) return new NextResponse(null, { status: 401 });

  return NextResponse.json({});
}
