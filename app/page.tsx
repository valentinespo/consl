import Link from "next/link";
import { getDashboard, getLots } from "@/lib/queries";
import { getRestock, getInventoryValueHistory } from "@/lib/restock";
import { money } from "@/lib/format";
import { Card, PageHeader, SectionTitle, FacilityTag } from "@/components/ui";
import { RecentLots } from "@/components/RecentLots";
import { TotalValueCard } from "@/components/TotalValueCard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [d, lots, { totals }, history] = await Promise.all([getDashboard(), getLots(), getRestock(), getInventoryValueHistory()]);
  const recent = lots.slice(0, 6);
  const maxFac = Math.max(1, ...d.byFacility.map((f) => f.value));

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Production value, raw inventory and recent activity at a glance." />

      <TotalValueCard totals={totals} history={history} />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <SectionTitle>Production value by facility</SectionTitle>
          <div className="space-y-3">
            {d.byFacility.map((f) => (
              <div key={f.code}>
                <div className="mb-1 flex items-center justify-between text-[13px]">
                  <FacilityTag code={f.code} />
                  <span className="font-medium text-ink tabular">{money(f.value)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-accent-strong" style={{ width: `${(f.value / maxFac) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
            <Mini label="Purchases" value={d.counts.purchases} />
            <Mini label="Transactions" value={d.counts.transactions} />
            <Mini label="Suppliers" value={d.counts.suppliers} />
          </div>
        </Card>

        <Card className="lg:col-span-2" padded={false}>
          <div className="flex items-center justify-between px-5 pt-5">
            <SectionTitle>Recent production lots</SectionTitle>
            <Link href="/lots" className="text-[12.5px] font-medium text-accent hover:underline">
              View all →
            </Link>
          </div>
          <RecentLots lots={recent} />
        </Card>
      </div>
    </>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[18px] font-semibold text-ink tabular">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}
