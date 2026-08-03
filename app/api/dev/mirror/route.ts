import { NextResponse } from "next/server";
import { prismaBase } from "@/lib/prisma-base";
import { decryptSecret } from "@/lib/secret-box";
import { makeClient } from "@/lib/spapi";
import { mirrorAmazonShipments } from "@/lib/shipment-mirror";

/** Maintenance-only (ALLOW_DEV_TASKS=1): run the shipment mirror for the connected org now. */
export async function POST() {
  if (process.env.ALLOW_DEV_TASKS !== "1") return new Response("Not found", { status: 404 });
  const conn = await prismaBase.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn?.refreshTokenEnc) return NextResponse.json({ error: "no connection" }, { status: 400 });
  const client = makeClient({
    refreshToken: decryptSecret(conn.refreshTokenEnc),
    marketplaceId: conn.marketplaceId ?? "ATVPDKIKX0DER",
    region: conn.region ?? "na",
  });
  await mirrorAmazonShipments(client, { id: conn.id, orgId: conn.orgId });
  const [shipments, lines, links] = await Promise.all([
    prismaBase.inboundShipment.count({ where: { orgId: conn.orgId! } }),
    prismaBase.inboundShipmentLine.count({ where: { orgId: conn.orgId! } }),
    prismaBase.movementShipmentLink.count({ where: { orgId: conn.orgId! } }),
  ]);
  return NextResponse.json({ ok: true, shipments, lines, links });
}
