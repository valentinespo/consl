import Link from "next/link";
import { brandUrlLabel } from "@/components/apply/options";
import { notFound } from "next/navigation";
import { prismaBase } from "@/lib/prisma-base";
import { Card } from "@/components/ui";
import { ChevronLeft } from "@/components/icons";
import { OpenCompanyButton, TrialToggle } from "@/components/internal/Actions";
import {
  ADS,
  BOOKKEEPING_TOOLS,
  FULFILLMENT,
  LONG_TERM_STOCK,
  LOT_TOOLS,
  STATUS,
  billingState,
  channelLines,
  fmtDate,
  fmtDateTime,
  keyLabel,
  listLabels,
} from "@/app/internal/format";

export const dynamic = "force-dynamic";

/** One application in full: who they are, every answer, where they are in the funnel. */
export default async function InternalApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await prismaBase.accessApplication.findUnique({
    where: { id },
    include: { organization: { select: { id: true, name: true, billingExempt: true, trialUnlockedAt: true, subscriptionStatus: true, onboardedAt: true, createdAt: true } } },
  });
  if (!a) notFound();
  const status = STATUS[a.status] ?? { label: a.status, pill: "pill-neutral" };
  const billing = billingState(a.organization);

  const answers: { label: string; value: string | string[] | null }[] = [
    { label: "Sales channels", value: channelLines(a.channels) },
    { label: "Fulfillment", value: listLabels(FULFILLMENT, a.fulfillment) },
    { label: "Long-term stock", value: listLabels(LONG_TERM_STOCK, a.longTermStock) },
    {
      label: "Lot tracking",
      value: a.lotTracking === "yes" ? `Yes — ${keyLabel(LOT_TOOLS, a.lotTrackingTool) ?? "tool not given"}` : a.lotTracking === "no" ? "No" : null,
    },
    { label: "How they track lots", value: a.lotTrackingHow },
    { label: "Ads", value: listLabels(ADS, a.adsChannels) },
    { label: "Bookkeeping tool", value: keyLabel(BOOKKEEPING_TOOLS, a.bookkeepingTool) },
    { label: "Bookkeeping today", value: a.bookkeeping },
    { label: "Biggest challenge", value: a.challenge },
  ];

  const timeline: { label: string; at: Date | null; detail?: string }[] = [
    { label: "Started the application", at: a.createdAt },
    { label: "Finished the questionnaire", at: a.completedAt },
    { label: "Created their account", at: a.accountCreatedAt },
    { label: "Booked the demo", at: a.callBookedAt, detail: a.callScheduledAt ? `Call: ${fmtDateTime(a.callScheduledAt)} (Buenos Aires)` : undefined },
    { label: "Trial unlocked", at: a.organization?.trialUnlockedAt ?? null },
    { label: "Finished the setup wizard", at: a.organization?.onboardedAt ?? null },
  ];

  return (
    <div>
      <Link href="/internal" className="mb-4 inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-ink-soft">
        <ChevronLeft size={14} /> All applications
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[24px] font-medium tracking-tight text-ink">{a.fullName}</h1>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${status.pill}`}>{status.label}</span>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${billing.pill}`}>{billing.label}</span>
          </div>
          <div className="mt-1 text-[13.5px] text-muted">
            {a.organization?.name ?? a.companyName}
            {a.organization && a.organization.name !== a.companyName ? ` (applied as ${a.companyName})` : ""}
            {a.brandUrl && (
              <>
                {" · "}
                <a href={a.brandUrl} target="_blank" rel="noreferrer" className="font-medium text-ink-soft underline decoration-line underline-offset-2 hover:text-ink">
                  {brandUrlLabel(a.brandUrl)}
                </a>
              </>
            )}
            {" · "}
            {a.email}
            {a.phone ? ` · ${a.phone}` : ""}
            {a.source ? ` · via ${a.source}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {a.organization && !a.organization.billingExempt && !a.organization.subscriptionStatus && (
            <TrialToggle orgId={a.organization.id} unlocked={!!a.organization.trialUnlockedAt} />
          )}
          {a.organization && <OpenCompanyButton orgId={a.organization.id} />}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Their answers</h2>
          <dl className="mt-3 divide-y divide-line">
            {answers.map((row) => (
              <div key={row.label} className="grid gap-1 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
                <dt className="text-[13px] font-medium text-ink-soft">{row.label}</dt>
                <dd className="text-[13.5px] leading-relaxed text-ink">
                  {row.value === null || row.value === undefined || (Array.isArray(row.value) && row.value.length === 0) ? (
                    <span className="text-muted">Not answered</span>
                  ) : Array.isArray(row.value) ? (
                    <ul className="space-y-0.5">
                      {row.value.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="whitespace-pre-wrap">{row.value}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Progress</h2>
          <ol className="mt-3 space-y-3">
            {timeline.map((t) => (
              <li key={t.label} className="flex items-start gap-3">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${t.at ? "bg-positive" : "border border-border bg-surface-2"}`} />
                <div className="min-w-0">
                  <div className={`text-[13px] ${t.at ? "text-ink" : "text-muted"}`}>{t.label}</div>
                  <div className="text-[11.5px] text-muted">{t.at ? fmtDateTime(t.at) : "not yet"}</div>
                  {t.detail && <div className="text-[11.5px] font-medium text-ink-soft">{t.detail}</div>}
                </div>
              </li>
            ))}
          </ol>
          {a.organization && (
            <div className="mt-4 border-t border-line pt-3 text-[11.5px] text-muted">
              Company created {fmtDate(a.organization.createdAt)}
              {a.callJoinUrl && (
                <>
                  {" · "}
                  <a href={a.callJoinUrl} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                    Join link
                  </a>
                </>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
