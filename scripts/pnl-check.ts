// Does every ledger dollar land on the statement or in a named bucket? Builds each company's
// P&L history the way the page does and reports the completeness gap per company (read-only).
//   node --import ./scripts/no-server-only.mjs --import tsx scripts/pnl-check.ts ["Company name"]
import { prismaBase } from "@/lib/prisma-base";
import { runWithOrg } from "@/lib/tenant";
import { getPnlHistory, getPnl } from "@/lib/pnl";
import { getOrgSettings } from "@/lib/settings";
import { zonedDayBounds } from "@/lib/pnl-periods";

async function main() {
  const only = process.argv[2];
  const orgs = await prismaBase.organization.findMany({ where: { deactivatedAt: null, ...(only ? { name: only } : {}) }, select: { id: true, name: true } });
  for (const org of orgs) {
    await runWithOrg(org.id, async () => {
      const tz = (await getOrgSettings()).syncTz;
      const t0 = Date.now();
      const h = await getPnlHistory(tz);
      const gapDays = h.days.filter((d) => d.gap);
      const gap = gapDays.reduce((t, d) => t + (d.gap ?? 0), 0);
      const ign = h.days.filter((d) => d.ign);
      console.log(`${org.name}: ${h.days.length} channel-days in ${Date.now() - t0}ms · channels ${h.channels.join("+") || "none"} · GAP ${Math.round(gap * 100) / 100} on ${gapDays.length} day(s) · left-out days ${ign.length} (${[...new Set(ign.flatMap((d) => d.ign![0]))].join(", ") || "-"})`);
      for (const d of gapDays.slice(0, 5)) console.log(`   gap ${d.c} ${d.d}: ${d.gap}`);
      if (h.days.length) {
        const to = h.newest;
        const from = new Date(new Date(`${to}T00:00:00Z`).getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
        const b = zonedDayBounds(from, to, tz);
        const p = await getPnl(b.from, b.to);
        console.log(`   last 30 days (${from}..${to}): sales ${p.sales.toFixed(2)} · net ${p.netProfit.toFixed(2)} · ledgerGap ${p.ledgerGap} · left out ${p.ignored.skus.join(", ") || "-"}`);
      }
    });
  }
  await prismaBase.$disconnect();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
