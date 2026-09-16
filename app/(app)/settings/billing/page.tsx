import { notFound } from "next/navigation";
import { requireView, currentRole } from "@/lib/membership";
import { getCurrentOrg } from "@/lib/org";
import { prismaBase } from "@/lib/prisma-base";
import { Card } from "@/components/ui";
import { FOUNDING_PRICE_USD, LIST_PRICE_USD, LIVE_SUBSCRIPTION } from "@/lib/billing";
import { BillingPortalButton } from "@/components/BillingPortalButton";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; pill: string; note: string }> = {
  trialing: { label: "Free trial", pill: "pill-green", note: "Nothing is charged until the trial ends." },
  active: { label: "Active", pill: "pill-green", note: "Renews automatically each month." },
  past_due: { label: "Payment failed", pill: "pill-amber", note: "Stripe is retrying your card. Update it below to keep access." },
  unpaid: { label: "Unpaid", pill: "pill-red", note: "Access is paused until the open invoice is paid." },
  canceled: { label: "Cancelled", pill: "pill-red", note: "Your subscription ended." },
  incomplete: { label: "Incomplete", pill: "pill-amber", note: "The first payment didn't go through." },
  incomplete_expired: { label: "Expired", pill: "pill-red", note: "Checkout wasn't completed in time." },
  paused: { label: "Paused", pill: "pill-amber", note: "The subscription is paused." },
};

const fmt = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null);

export default async function BillingSettingsPage() {
  await requireView("settings");
  const org = await getCurrentOrg();
  if (!org) notFound();
  const role = await currentRole();
  const row = await prismaBase.organization.findUnique({
    where: { id: org.id },
    select: { subscriptionStatus: true, trialEndsAt: true, currentPeriodEnd: true, foundingMember: true, stripeCustomerId: true, billingExempt: true },
  });
  const status = row?.subscriptionStatus ? (STATUS[row.subscriptionStatus] ?? { label: row.subscriptionStatus, pill: "pill-neutral", note: "" }) : null;
  const live = LIVE_SUBSCRIPTION.has(row?.subscriptionStatus ?? "");
  const price = row?.foundingMember ? FOUNDING_PRICE_USD : LIST_PRICE_USD;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Your plan</h2>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <div className="text-[28px] font-semibold tracking-tight text-ink">
            ${price.toLocaleString("en-US", { minimumFractionDigits: price % 1 ? 2 : 0 })}
            <span className="text-[14px] font-normal text-muted">/month</span>
          </div>
          {row?.foundingMember && (
            <span className="pill-chart inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium">
              Founding member · 50%OFF for life
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[13px] text-muted">
          {row?.billingExempt
            ? "This company isn't billed."
            : row?.foundingMember
              ? `The list price is $${LIST_PRICE_USD}/month. Your early-access rate is locked for as long as you stay subscribed.`
              : "Everything in consl, for every channel you connect."}
        </p>

        <dl className="mt-5 divide-y divide-line text-[13.5px]">
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-muted">Status</dt>
            <dd>
              {status ? (
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${status.pill}`}>{status.label}</span>
              ) : row?.billingExempt ? (
                <span className="text-ink-soft">Not billed</span>
              ) : (
                <span className="text-ink-soft">No subscription yet</span>
              )}
            </dd>
          </div>
          {row?.subscriptionStatus === "trialing" && row.trialEndsAt && (
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-muted">Trial ends</dt>
              <dd className="text-ink">{fmt(row.trialEndsAt)}</dd>
            </div>
          )}
          {live && row?.currentPeriodEnd && (
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-muted">{row.subscriptionStatus === "trialing" ? "First charge" : "Next charge"}</dt>
              <dd className="text-ink">{fmt(row.currentPeriodEnd)}</dd>
            </div>
          )}
        </dl>
        {status?.note && <p className="mt-3 text-[12.5px] text-muted">{status.note}</p>}
      </Card>

      <Card>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Manage</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Your card, invoices and receipts live in Stripe&apos;s secure billing portal. You can update the card or cancel there at any time.
        </p>
        <div className="mt-4">
          {row?.stripeCustomerId ? (
            role === "owner" ? (
              <BillingPortalButton />
            ) : (
              <p className="text-[12.5px] text-muted">Only an owner can manage billing.</p>
            )
          ) : (
            <p className="text-[12.5px] text-muted">{row?.billingExempt ? "Nothing to manage." : "The portal opens once your subscription starts."}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
