import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/org";

/** Small, tenant-scoped reads shared by the report and its live-change check. */
export async function getLtvContext() {
  const [connection, settings, org, latestOrder] = await Promise.all([
    prisma.integration.findFirst({ where: { provider: "shopify", status: "connected" }, select: { sellerId: true, timezone: true } }),
    prisma.settings.findFirst({ select: { ltvExcludedChannels: true, shopifyLtvState: true, shopifySyncedThrough: true } }),
    getCurrentOrg(),
    // Include voided orders: void/unvoid must both change the revision. The composite index
    // makes this a single-row lookup rather than reloading the entire order history every poll.
    prisma.salesOrder.findFirst({ where: { channel: "SHOPIFY" }, orderBy: { updatedAt: "desc" }, select: { id: true, updatedAt: true } }),
  ]);
  const revision = createHash("sha256").update(JSON.stringify({
    org: org && { id: org.id, currency: org.currencyCode, locale: org.locale },
    connection,
    settings,
    latestOrder,
    // Time alone can mature a cohort or move a date preset. This also bounds recovery from
    // same-timestamp writes or transactions committing out of updatedAt order to one minute.
    minute: Math.floor(Date.now() / 60_000),
  })).digest("hex");
  return { connection, settings, org, revision };
}
