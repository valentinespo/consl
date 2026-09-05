import { runWithOrg } from "@/lib/tenant";
// Full re-walk of the Amazon money ledger through the v2024-06-19 importer: reset the backfill
// cursor, then step backwards 7 days at a time until the two-year floor. Every step upserts by
// transaction id and replaces the legacy (v0) rows of its window, so it is safe to re-run.
(async () => {
  const orgId = process.env.DEV_ORG_ID!;
  await runWithOrg(orgId, async () => {
    const { prisma } = await import("@/lib/prisma");
    const { saveOrgSettings } = await import("@/lib/settings");
    const { backfillAmazonFinancesStep, sweepAmazonFinances } = await import("@/lib/finances");
    if (process.env.RESET_CURSOR === "1") await saveOrgSettings({ financeBackfillCursor: null });
    const t0 = Date.now();
    let steps = 0, total = 0;
    for (;;) {
      try {
        const r = await backfillAmazonFinancesStep();
        steps++; total += r.rows;
        console.log(`[${((Date.now() - t0) / 60000).toFixed(1)}m] step ${steps}: +${r.rows} rows, cursor ${r.cursor.slice(0, 10)}${r.done ? " DONE" : ""}`);
        if (r.done) break;
      } catch (e) {
        console.error("step failed, retrying in 30s:", (e as Error).message.slice(0, 200));
        await new Promise((res) => setTimeout(res, 30_000));
      }
    }
    const sweep = await sweepAmazonFinances();
    const legacy = await prisma.financeEvent.count({ where: { channel: "AMAZON", txId: null } });
    const held = await prisma.financeEvent.aggregate({ where: { channel: "AMAZON", status: "held", type: "Principal" }, _sum: { amount: true }, _count: true });
    console.log(`finished: ${steps} steps, ${total} rows, sweep +${sweep?.rows ?? 0}; legacy rows left: ${legacy}; held principal: ${held._count} rows ${held._sum.amount?.toFixed(2)}`);
    await prisma.$disconnect();
  });
})();
