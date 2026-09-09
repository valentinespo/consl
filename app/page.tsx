import { getDashboard, getLeadTimes, getLots } from "@/lib/queries";
import { getRestock, getInventoryValueHistory } from "@/lib/restock";
import { prisma } from "@/lib/prisma";
import { getAlerts } from "@/lib/alerts";
import { getOrgSettings } from "@/lib/settings";
import { DashboardGrid, type DashboardData } from "@/components/DashboardGrid";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireView("dashboard");
  // Setup is the onboarding wizard's job — every company arrives here already set up, so the
  // dashboard carries no second checklist.
  const [d, lots, restock, history, settings, leadTimes, connections] = await Promise.all([
    getDashboard(),
    getLots(),
    getRestock(),
    getInventoryValueHistory(),
    getOrgSettings(),
    getLeadTimes(),
    prisma.integration.findMany({ where: { status: "connected" }, select: { provider: true } }),
  ]);
  const alerts = await getAlerts(restock.rows);

  const data: DashboardData = {
    totals: restock.totals,
    history,
    connected: connections.map((c) => c.provider),
    facility: d.byFacility,
    prodTotal: d.productionCOGValue,
    spentBySupplier: d.spentBySupplier,
    spentTotal: d.spentTotal,
    recentLots: lots.slice(0, 6),
    alerts,
    leadTimes: { ...leadTimes, configuredDays: Math.round(settings.defaultLeadMonths * 30.44) },
  };

  return (
    <DashboardGrid
      data={data}
      initialLayout={settings.dashboardLayout}
      title="Dashboard"
      subtitle="Production value, raw inventory and recent activity at a glance."
    />
  );
}
