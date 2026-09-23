// Are TikTok's orders all here? TikTok's own order count for each of the last 14 days against
// consl's (the nightly audit, run now), then a re-read of everything TikTok changed since a date
// (an upsert: it can only add or refresh orders). Read-only towards TikTok.
//   node --import ./scripts/no-server-only.mjs --import tsx scripts/tiktok-check.ts "Herbl Inc." 2026-09-01
import { prismaBase } from "@/lib/prisma-base";
import { runWithOrg } from "@/lib/tenant";
import { auditTikTokOrderCounts } from "@/lib/order-count-audit";
import { importTikTokOrders } from "@/lib/orders";

async function main() {
  const [name, sinceDay] = process.argv.slice(2);
  if (!name) throw new Error("usage: tiktok-check.ts <company name> [since YYYY-MM-DD]");
  const org = await prismaBase.organization.findFirst({ where: { name }, select: { id: true } });
  if (!org) throw new Error(`no company named ${name}`);
  await runWithOrg(org.id, async () => {
    const before = await prismaBase.salesOrder.count({ where: { orgId: org.id, channel: "TIKTOK" } });
    console.log("AUDIT (TikTok's daily counts vs ours):", JSON.stringify(await auditTikTokOrderCounts()));
    if (sinceDay) {
      console.log(`RE-READ since ${sinceDay}:`, JSON.stringify(await importTikTokOrders(new Date(`${sinceDay}T00:00:00Z`))));
    }
    const after = await prismaBase.salesOrder.count({ where: { orgId: org.id, channel: "TIKTOK" } });
    console.log(`TikTok orders in consl: before ${before}, after ${after}`);
    const latest = await prismaBase.salesOrder.findMany({ where: { orgId: org.id, channel: "TIKTOK" }, orderBy: { orderedAt: "desc" }, take: 3, select: { externalId: true, orderedAt: true, status: true, total: true } });
    console.log("latest:", JSON.stringify(latest));
  });
  await prismaBase.$disconnect();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
