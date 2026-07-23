import { getDashboard, getLots, getSetupProgress, SETUP_DISMISS_KEY } from "@/lib/queries";
import { getRestock, getInventoryValueHistory } from "@/lib/restock";
import { getAlerts } from "@/lib/alerts";
import { getOrgSettings } from "@/lib/settings";
import { getCurrentOrg } from "@/lib/org";
import { PageHeader } from "@/components/ui";
import { DashboardGrid, type DashboardData } from "@/components/DashboardGrid";
import { GettingStarted, type SetupStep } from "@/components/GettingStarted";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [d, lots, restock, history, settings, setup, org] = await Promise.all([
    getDashboard(),
    getLots(),
    getRestock(),
    getInventoryValueHistory(),
    getOrgSettings(),
    getSetupProgress(),
    getCurrentOrg(),
  ]);
  const alerts = await getAlerts(restock.rows);

  // Ordered so each step unlocks the next: identity → what you sell → where → who → activity.
  const steps: SetupStep[] = [
    { label: "Add your company details", body: "used on purchase orders", href: "/settings/company", cta: "Set up", done: !!org?.address },
    { label: "Add your first product", body: "what you sell", href: "/catalog", cta: "Add", done: setup.products > 0 },
    { label: "Add a facility", body: "where stock is made or stored", href: "/facilities", cta: "Add", done: setup.facilities > 0 },
    { label: "Add a supplier", body: "who you buy from", href: "/suppliers", cta: "Add", done: setup.suppliers > 0 },
    { label: "Link a sales channel", body: "Amazon, Shopify or TikTok IDs", href: "/catalog", cta: "Map", done: setup.mapped > 0 },
    { label: "Log a purchase", body: "raw materials you've bought", href: "/purchases", cta: "Log", done: setup.purchases > 0 },
    { label: "Create a production lot", body: "turns materials into product", href: "/lots", cta: "Create", done: setup.lots > 0 },
  ];

  const data: DashboardData = {
    totals: restock.totals,
    history,
    facility: d.byFacility,
    facilityPurchases: d.purchasesByFacility,
    prodTotal: d.productionCOGValue,
    purchTotal: d.purchasesTotal,
    counts: { purchases: d.counts.purchases, transactions: d.counts.transactions, suppliers: d.counts.suppliers },
    recentLots: lots.slice(0, 6),
    alerts,
  };

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Production value, raw inventory and recent activity at a glance." />
      {!setup.dismissed && <GettingStarted steps={steps} dismissKey={SETUP_DISMISS_KEY} />}
      <DashboardGrid data={data} initialLayout={settings.dashboardLayout} />
    </>
  );
}
