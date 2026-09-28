import { notFound } from "next/navigation";
import { requireView, currentRole } from "@/lib/membership";
import { getCurrentOrg } from "@/lib/org";
import { prismaBase } from "@/lib/prisma-base";
import { Card } from "@/components/ui";
import { FOUNDING_PRICE_USD, LIST_PRICE_USD, LIVE_SUBSCRIPTION } from "@/lib/billing";
import { BillingPortalButton } from "@/components/BillingPortalButton";
import { shopifyBillingView } from "@/lib/shopify-billing";

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
  // A company that came in through Shopify pays through Shopify: its plan lives there.
  const shopify = await shopifyBillingView(org.id);
  if (shopify)
    return <ShopifyBilling orgId={org.id} shop={shopify.shop} planUrl={shopify.planUrl} installed={shopify.installed} canManage={role === "owner"} />;
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

const SHOPIFY_STATUS: Record<string, { label: string; pill: string; note: string }> = {
  trial: { label: "Free trial", pill: "pill-green", note: "Nothing is charged until the trial ends." },
  active: { label: "Active", pill: "pill-green", note: "Renews automatically each month on your Shopify bill." },
  cancelling: { label: "Cancelled", pill: "pill-amber", note: "The plan runs until the end of this period, then consl closes." },
};

/** The plan of a company billed through Shopify: read from Shopify, managed on Shopify's plan page. */
async function ShopifyBilling({
  orgId,
  shop,
  planUrl,
  installed,
  canManage,
}: {
  orgId: string;
  shop: string;
  planUrl: string | null;
  installed: boolean;
  canManage: boolean;
}) {
  const row = await prismaBase.organization.findUnique({
    where: { id: orgId },
    select: { shopifyPlanStatus: true, shopifyPlanPrice: true, shopifyTrialEndsAt: true, shopifyPeriodEnd: true, shopifyPlanTest: true },
  });
  const status = row?.shopifyPlanStatus ? SHOPIFY_STATUS[row.shopifyPlanStatus] : null;
  // A development store's plan is free of charge by Shopify's rule: show the plan's list price.
  const price = row?.shopifyPlanPrice && row.shopifyPlanPrice > 0 ? row.shopifyPlanPrice : LIST_PRICE_USD;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Your plan</h2>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <div className="text-[28px] font-semibold tracking-tight text-ink">
            ${price.toLocaleString("en-US", { minimumFractionDigits: price % 1 ? 2 : 0 })}
            <span className="text-[14px] font-normal text-muted">/month</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-2.5 py-0.5 text-[11px] font-medium text-ink-soft">
            <span className="grid h-3.5 w-3.5 place-items-center rounded-sm bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/integrations/shopify.png" alt="" className="max-h-full max-w-full object-contain" />
            </span>
            Billed through Shopify
          </span>
        </div>
        <p className="mt-1.5 text-[13px] text-muted">Charged on {shop}&apos;s Shopify bill. Everything in consl, for every channel you connect.</p>

        <dl className="mt-5 divide-y divide-line text-[13.5px]">
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-muted">Status</dt>
            <dd>
              {status ? (
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${status.pill}`}>{status.label}</span>
              ) : (
                <span className="text-ink-soft">No plan</span>
              )}
            </dd>
          </div>
          {row?.shopifyPlanStatus === "trial" && row.shopifyTrialEndsAt && (
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-muted">Trial ends</dt>
              <dd className="text-ink">{fmt(row.shopifyTrialEndsAt)}</dd>
            </div>
          )}
          {row?.shopifyPeriodEnd && (row.shopifyPlanStatus === "active" || row.shopifyPlanStatus === "cancelling") && (
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-muted">{row.shopifyPlanStatus === "cancelling" ? "Ends" : "Next charge"}</dt>
              <dd className="text-ink">{fmt(row.shopifyPeriodEnd)}</dd>
            </div>
          )}
        </dl>
        {status?.note && <p className="mt-3 text-[12.5px] text-muted">{status.note}</p>}
        {row?.shopifyPlanTest && status && <p className="mt-2 text-[12.5px] text-muted">Development store: Shopify doesn&apos;t charge this plan.</p>}
      </Card>

      <Card>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Manage</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Your plan and invoices live in your Shopify admin. You can change or cancel the plan there at any time.
        </p>
        <div className="mt-4">
          {!canManage ? (
            <p className="text-[12.5px] text-muted">Only an owner can manage billing.</p>
          ) : !installed ? (
            <p className="text-[12.5px] text-muted">
              consl isn&apos;t installed on {shop} right now.{" "}
              <a href="/settings/integrations" className="font-medium text-accent hover:underline">
                Reconnect the store
              </a>{" "}
              to pick a plan.
            </p>
          ) : planUrl ? (
            <a
              href={planUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-ink px-3.5 text-[13px] font-medium text-bg hover:opacity-90"
            >
              {status ? "Manage plan in Shopify" : "Choose a plan in Shopify"}
            </a>
          ) : (
            <p className="text-[12.5px] text-muted">Open your Shopify admin, then Apps, then consl.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
