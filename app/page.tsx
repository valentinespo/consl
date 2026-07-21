import { getDashboard, getLots } from "@/lib/queries";
import { getRestock, getInventoryValueHistory } from "@/lib/restock";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { DashboardGrid, type DashboardData } from "@/components/DashboardGrid";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [d, lots, { totals }, history, settings] = await Promise.all([
    getDashboard(),
    getLots(),
    getRestock(),
    getInventoryValueHistory(),
    prisma.settings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {} }),
  ]);

  const data: DashboardData = {
    totals,
    history,
    facility: d.byFacility,
    counts: { purchases: d.counts.purchases, transactions: d.counts.transactions, suppliers: d.counts.suppliers },
    recentLots: lots.slice(0, 6),
    rawInventoryValue: d.rawInventoryValue,
    inProductionValue: d.inProductionValue,
    totalUnits: d.totalUnits,
  };

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Production value, raw inventory and recent activity at a glance." />
      <DashboardGrid data={data} initialLayout={settings.dashboardLayout} />
    </>
  );
}
