import { runWithOrg } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { importAmazonFinances } from "@/lib/finances";
// Re-walk Herbl Onboarded's Amazon ledger with the current importer: every 7-day window from today
// back to Amazon's retention floor, upserting by transaction id (legacy rows in each window are
// replaced). The org's own cursor is left alone.
const orgId = "cmswaih59012m1ypmm3164ndz";
const DAY = 86_400_000;
runWithOrg(orgId, async () => {
  const floor = new Date(Date.now() - 729 * DAY);
  let end = new Date(Date.now() - 5 * 60_000); // Amazon refuses an end within 2 minutes of now
  let windows = 0, rows = 0;
  while (end > floor) {
    const start = new Date(Math.max(end.getTime() - 7 * DAY, floor.getTime()));
    try {
      const r = await importAmazonFinances(start, end);
      rows += r.rows;
      windows++;
      console.log(`${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}: ${r.rows} rows`);
    } catch (e) {
      const msg = (e as Error).message;
      console.log(`${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}: FAILED ${msg.slice(0, 160)}`);
      if (/2 years/i.test(msg)) break;
      await new Promise((r) => setTimeout(r, 30_000));
      continue; // retry the same window
    }
    end = start;
  }
  const mcf = await prisma.financeEvent.aggregate({ where: { channel: "AMAZON", type: { startsWith: "MCF:" } }, _count: true, _sum: { baseAmount: true } });
  const legacy = await prisma.financeEvent.count({ where: { channel: "AMAZON", marketplaceId: null } });
  console.log(`finished: ${windows} windows, ${rows} rows; MCF rows now ${mcf._count} $${(mcf._sum.baseAmount ?? 0).toFixed(2)}; legacy rows left ${legacy}`);
}).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
