import { NextResponse } from "next/server";
import { prismaBase } from "@/lib/prisma-base";
import { decryptSecret } from "@/lib/secret-box";
import { makeClient, getFbaInboundShipments, getFbaInboundShipmentItems, getAwdInboundShipments } from "@/lib/spapi";

/**
 * Maintenance-only (ALLOW_DEV_TASKS=1, local dev): fetch the connected org's live inbound
 * shipments straight from SP-API — the Phase-3 gate that the fetchers match Seller Central
 * reality before any of it is persisted. Read-only against Amazon; writes nothing.
 */
export async function GET(request: Request) {
  if (process.env.ALLOW_DEV_TASKS !== "1") return new Response("Not found", { status: 404 });
  const days = Number(new URL(request.url).searchParams.get("days") ?? 90);
  const conn = await prismaBase.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn?.refreshTokenEnc) return NextResponse.json({ error: "no connected amazon integration" }, { status: 400 });
  const client = makeClient({
    refreshToken: decryptSecret(conn.refreshTokenEnc),
    marketplaceId: conn.marketplaceId ?? "ATVPDKIKX0DER",
    region: conn.region ?? "na",
  });
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [fba, awd] = await Promise.all([getFbaInboundShipments(client, since), getAwdInboundShipments(client, since)]);
  const fbaWithItems = [];
  for (const h of fba.slice(0, 10)) fbaWithItems.push({ header: h, items: await getFbaInboundShipmentItems(client, h.externalId) });
  return NextResponse.json({ fbaCount: fba.length, awdCount: awd.length, fba: fbaWithItems, awd });
}
