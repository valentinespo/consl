import { runWithOrg } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { resolveAllFulfillment } from "@/lib/fulfillment";
const orgs = (process.env.ORGS ?? "").split(",").filter(Boolean);
(async () => {
  for (const spec of orgs) {
    const [id, label] = spec.split(":");
    await runWithOrg(id, async () => {
      const changed = await resolveAllFulfillment();
      const rows = await prisma.$queryRaw<{ channel: string; label: string | null; facility: string | null; n: number }[]>`
        SELECT o.channel, o."fulfillmentLabel" AS label, f.name AS facility, COUNT(*)::int AS n
        FROM "SalesOrder" o LEFT JOIN "Facility" f ON f.id = o."fulfillmentFacilityId"
        WHERE o."orgId" = ${id} GROUP BY 1, 2, 3 ORDER BY 1, 4 DESC`;
      console.log(`${label}: resolved ${changed} orders`);
      for (const r of rows) console.log(`  ${r.channel.padEnd(8)} ${String(r.label).padEnd(20)} → ${String(r.facility).padEnd(18)} ${r.n}`);
    });
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
