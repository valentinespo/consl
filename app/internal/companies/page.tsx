import { prismaBase } from "@/lib/prisma-base";
import { Card, PageHeader } from "@/components/ui";
import { OpenCompanyButton, TrialToggle } from "@/components/internal/Actions";
import { billingState, fmtDate } from "@/app/internal/format";

export const dynamic = "force-dynamic";

/** Every live company on the platform, with where each stands — open any of them from here. */
export default async function InternalCompaniesPage() {
  const orgs = await prismaBase.organization.findMany({
    where: { deactivatedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      onboardedAt: true,
      billingExempt: true,
      trialUnlockedAt: true,
      subscriptionStatus: true,
      _count: { select: { memberships: true, products: true, salesOrders: true } },
    },
  });

  return (
    <div>
      <PageHeader title="Companies" subtitle={`${orgs.length} live compan${orgs.length === 1 ? "y" : "ies"} on the platform`} />
      <Card padded={false} className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-5 py-2.5 font-medium">Company</th>
              <th className="px-2 py-2.5 text-right font-medium">Members</th>
              <th className="px-2 py-2.5 text-right font-medium">Products</th>
              <th className="px-2 py-2.5 text-right font-medium">Orders</th>
              <th className="px-2 py-2.5 font-medium">Setup</th>
              <th className="px-2 py-2.5 font-medium">Billing</th>
              <th className="px-2 py-2.5 font-medium">Created</th>
              <th className="px-5 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => {
              const billing = billingState(o);
              return (
                <tr key={o.id} className="border-b border-line align-middle last:border-0 hover:bg-surface-2/60">
                  <td className="px-5 py-3 font-medium text-ink">{o.name}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-ink-soft">{o._count.memberships}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-ink-soft">{o._count.products}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-ink-soft">{o._count.salesOrders}</td>
                  <td className="px-2 py-3 text-ink-soft">{o.onboardedAt ? `Done ${fmtDate(o.onboardedAt)}` : <span className="text-muted">Wizard pending</span>}</td>
                  <td className="px-2 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${billing.pill}`}>{billing.label}</span>
                  </td>
                  <td className="px-2 py-3 text-muted">{fmtDate(o.createdAt)}</td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {!o.billingExempt && !o.subscriptionStatus && <TrialToggle orgId={o.id} unlocked={!!o.trialUnlockedAt} />}
                      <OpenCompanyButton orgId={o.id} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
