import { SignOutButton } from "@clerk/nextjs";

/**
 * The billing gate for a company that pays through Shopify (lib/shopify-billing): it came in from a
 * Shopify install, so its plan is picked, changed and cancelled on Shopify's own plan page and the
 * charge lands on its Shopify bill. Three states: a first choice, a plan that has ended, and a store
 * that uninstalled consl (reinstall first, then pick the plan).
 */
export function ShopifyPlanGate({
  orgName,
  shop,
  planUrl,
  installed,
  lapsed,
  trialDays,
}: {
  orgName: string;
  shop: string;
  planUrl: string | null;
  installed: boolean;
  lapsed: boolean;
  trialDays: number;
}) {
  const reinstallUrl = `/api/integrations/shopify/connect?shop=${encodeURIComponent(shop)}`;
  const title = !installed ? "Reinstall consl on your store" : lapsed ? "Your plan has ended" : "Choose your plan in Shopify";
  const body = !installed
    ? `consl was removed from ${shop}. Reinstall it, then pick your plan in Shopify to open ${orgName} again. Everything you had in consl is still here.`
    : lapsed
      ? `Pick a plan in Shopify to open ${orgName} again. Everything you had in consl is still here.`
      : `consl is billed through your Shopify account. Pick the plan in Shopify to start your ${trialDays}-day free trial. You can change or cancel it there at any time.`;

  return (
    <div className="min-h-screen bg-surface-2 px-5 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-[600px]">
        <div className="mb-6 flex items-center justify-between">
          <span className="inline-flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/consl-mark.png" alt="" className="iso-invert h-5 w-5 object-contain" />
            <span className="text-[15px] font-bold tracking-tight text-ink">consl</span>
          </span>
          <div className="flex items-center gap-3 text-[13px]">
            <span className="max-w-[200px] truncate text-muted">{orgName}</span>
            <SignOutButton redirectUrl="/home">
              <button className="rounded-lg border border-border bg-surface px-3 py-1.5 font-medium text-ink-soft hover:bg-surface-2">Sign out</button>
            </SignOutButton>
          </div>
        </div>

        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-7 shadow-sm sm:p-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-bg px-3 py-1 text-[12px] font-medium text-ink-soft">
            <span className="grid h-4 w-4 place-items-center rounded bg-white p-0.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/integrations/shopify.png" alt="" className="max-h-full max-w-full object-contain" />
            </span>
            {shop}
          </span>
          <h1 className="mt-4 text-[24px] font-semibold leading-tight tracking-tight text-ink sm:text-[27px]">{title}</h1>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted">{body}</p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {!installed ? (
              <a href={reinstallUrl} className="inline-flex h-10 items-center justify-center rounded-lg bg-ink px-4 text-[14px] font-medium text-bg hover:opacity-90">
                Reinstall on Shopify
              </a>
            ) : planUrl ? (
              <a href={planUrl} target="_top" className="inline-flex h-10 items-center justify-center rounded-lg bg-ink px-4 text-[14px] font-medium text-bg hover:opacity-90">
                {lapsed ? "Choose a plan in Shopify" : "Choose your plan in Shopify"}
              </a>
            ) : (
              <span className="text-[13.5px] text-muted">Plans open shortly. Check back in a few minutes.</span>
            )}
            {installed && planUrl && (
              <a href="/pre-onboarding" className="text-[13px] font-medium text-ink-soft hover:text-ink">
                Already picked it? Check again
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
