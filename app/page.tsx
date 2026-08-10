import { getDashboard, getLeadTimes, getLots, getSetupProgress, SETUP_DISMISS_KEY } from "@/lib/queries";
import { getRestock, getInventoryValueHistory } from "@/lib/restock";
import { prisma } from "@/lib/prisma";
import { getAlerts } from "@/lib/alerts";
import { getOrgSettings } from "@/lib/settings";
import { getCurrentOrg } from "@/lib/org";
import { DashboardGrid, type DashboardData } from "@/components/DashboardGrid";
import { GettingStarted, type SetupStep } from "@/components/GettingStarted";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireView("dashboard");
  const [d, lots, restock, history, settings, setup, org, leadTimes, connections] = await Promise.all([
    getDashboard(),
    getLots(),
    getRestock(),
    getInventoryValueHistory(),
    getOrgSettings(),
    getSetupProgress(),
    getCurrentOrg(),
    getLeadTimes(),
    prisma.integration.findMany({ where: { status: "connected" }, select: { provider: true } }),
  ]);
  const alerts = await getAlerts(restock.rows);

  // Ordered so each step unlocks the next: identity → what you sell → where → who → activity.
  const steps: SetupStep[] = [
    { label: "Add your company details", body: "used on purchase orders", href: "/settings/company", cta: "Set up", done: !!org?.address },
    { label: "Add your first product", body: "what you sell", href: "/catalog", cta: "Add", done: setup.products > 0 },
    { label: "Add raw materials", body: "what products are made from", href: "/catalog", cta: "Add", done: setup.materials > 0 },
    { label: "Add a facility", body: "where stock is made or stored", href: "/facilities", cta: "Add", done: setup.facilities > 0 },
    { label: "Add a supplier", body: "who you buy from", href: "/suppliers", cta: "Add", done: setup.suppliers > 0 },
    { label: "Link a sales channel", body: "Amazon, Shopify or TikTok IDs", href: "/catalog", cta: "Map", done: setup.mapped > 0 },
    { label: "Log a purchase", body: "raw materials you've bought", href: "/purchases", cta: "Log", done: setup.purchases > 0 },
    { label: "Create a production lot", body: "turns materials into product", href: "/lots", cta: "Create", done: setup.lots > 0 },
  ];

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
      banner={!setup.dismissed && <GettingStarted steps={steps} dismissKey={SETUP_DISMISS_KEY} />}
    />
  );
}
