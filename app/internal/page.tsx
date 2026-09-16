import Link from "next/link";
import { prismaBase } from "@/lib/prisma-base";
import { Card, PageHeader } from "@/components/ui";
import { OpenCompanyButton, TrialToggle } from "@/components/internal/Actions";
import { STATUS, billingState, fmtDate, fmtDateTime, keyLabel, CHANNELS_LIST } from "@/app/internal/format";

export const dynamic = "force-dynamic";

/** Every early-access application, newest first — the brand manager's queue. */
export default async function InternalApplicationsPage() {
  const apps = await prismaBase.accessApplication.findMany({
    orderBy: { createdAt: "desc" },
    include: { organization: { select: { id: true, name: true, billingExempt: true, trialUnlockedAt: true, subscriptionStatus: true, onboardedAt: true } } },
  });
  const counts = {
    total: apps.length,
    booked: apps.filter((a) => a.status === "call_booked").length,
    waiting: apps.filter((a) => a.organization && !a.organization.billingExempt && !a.organization.trialUnlockedAt && !a.organization.subscriptionStatus).length,
  };

  return (
    <div>
      <PageHeader
        title="Applications"
        subtitle={`${counts.total} started · ${counts.booked} with a call booked · ${counts.waiting} waiting for their trial to be unlocked`}
      />
      <Card padded={false} className="overflow-x-auto">
        {apps.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13.5px] text-muted">Nobody has started the application yet.</div>
        ) : (
          <table className="w-full min-w-[980px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-2.5 font-medium">Applicant</th>
                <th className="px-2 py-2.5 font-medium">Company</th>
                <th className="px-2 py-2.5 font-medium">Main channel</th>
                <th className="px-2 py-2.5 font-medium">Status</th>
                <th className="px-2 py-2.5 font-medium">Call</th>
                <th className="px-2 py-2.5 font-medium">Billing</th>
                <th className="px-2 py-2.5 font-medium">Started</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => {
                const status = STATUS[a.status] ?? { label: a.status, pill: "pill-neutral" };
                const billing = billingState(a.organization);
                return (
                  <tr key={a.id} className="border-b border-line align-top last:border-0 hover:bg-surface-2/60">
                    <td className="px-5 py-3">
                      <Link href={`/internal/applications/${a.id}`} className="font-medium text-ink hover:underline">
                        {a.fullName}
                      </Link>
                      <div className="text-[12px] text-muted">{a.email}</div>
                    </td>
                    <td className="px-2 py-3">
                      <div className="text-ink-soft">{a.organization?.name ?? a.companyName}</div>
                      {a.organization && a.organization.name !== a.companyName && <div className="text-[11.5px] text-muted">applied as {a.companyName}</div>}
                    </td>
                    <td className="px-2 py-3 text-ink-soft">{keyLabel(CHANNELS_LIST, a.mainChannel) ?? "—"}</td>
                    <td className="px-2 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${status.pill}`}>{status.label}</span>
                    </td>
                    <td className="px-2 py-3 text-ink-soft">
                      {a.callScheduledAt ? (
                        <>
                          <div>{fmtDateTime(a.callScheduledAt)}</div>
                          <div className="text-[11px] text-muted">Buenos Aires time</div>
                        </>
                      ) : a.callBookedAt ? (
                        <>
                          <div>Booked {fmtDate(a.callBookedAt)}</div>
                          <div className="text-[11px] text-muted">time not fetched</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${billing.pill}`}>{billing.label}</span>
                    </td>
                    <td className="px-2 py-3 text-muted">{fmtDate(a.createdAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {a.organization && !a.organization.billingExempt && !a.organization.subscriptionStatus && (
                          <TrialToggle orgId={a.organization.id} unlocked={!!a.organization.trialUnlockedAt} />
                        )}
                        {a.organization && <OpenCompanyButton orgId={a.organization.id} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
