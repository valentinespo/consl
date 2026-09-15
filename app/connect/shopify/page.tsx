import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/current-user";
import { getCurrentOrg } from "@/lib/org";
import { currentRole } from "@/lib/membership";
import { readPendingInstall, connectedShopOf } from "@/lib/shopify-oauth";
import { PROVIDER_LOGO } from "@/lib/channel-logos";
import { AlertTriangle } from "@/components/icons";

export const dynamic = "force-dynamic";

const CLAIM = "/api/integrations/shopify/claim";

const primaryCls = "inline-flex h-10 w-full items-center justify-center rounded-lg bg-ink text-[14px] font-medium text-bg hover:opacity-90";
const secondaryCls =
  "inline-flex h-10 w-full items-center justify-center rounded-lg border border-border bg-surface text-[14px] font-medium text-ink-soft hover:bg-surface-2";
const dangerCls = "inline-flex h-10 w-full items-center justify-center rounded-lg bg-negative text-[14px] font-medium text-white hover:opacity-90";

/**
 * Where an install that started on Shopify's side lands after the store has authorized consl
 * (Shopify requires authorization before any sign-in). The store's token is parked; this page
 * finishes the job: sign in or sign up, then attach the store to a company — asking first when
 * that company is already connected to a different store.
 */
export default async function ConnectShopifyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const pending = await readPendingInstall();
  const userId = await currentUserId();
  const org = userId ? await getCurrentOrg().catch(() => null) : null;
  if (pending && userId && !org) redirect("/welcome"); // create the company first; the wizard attaches the store
  const role = org ? await currentRole() : null;
  const current = org ? await connectedShopOf(org.id) : null;

  let title: string;
  let body: React.ReactNode;
  let actions: React.ReactNode;

  if (error) {
    title = "Shopify didn't finish connecting";
    body = (
      <>
        <span className="block rounded-lg tint-red px-3 py-2 text-negative">
          <AlertTriangle size={14} className="mr-1.5 inline-block align-[-2px]" />
          {error}
        </span>
        <span className="mt-3 block">Start again from your store&apos;s Apps page, or from Integrations in consl.</span>
      </>
    );
    actions = userId ? (
      <Link href="/settings/integrations" className={primaryCls}>
        Go to Integrations
      </Link>
    ) : (
      <Link href="/sign-in" className={primaryCls}>
        Sign in
      </Link>
    );
  } else if (!pending) {
    title = "Nothing waiting to connect";
    body = "This store is already attached, or the link is older than a day. Start again from your store's Apps page, or from Integrations in consl.";
    actions = userId ? (
      <Link href="/" className={primaryCls}>
        Open consl
      </Link>
    ) : (
      <Link href="/sign-in" className={primaryCls}>
        Sign in
      </Link>
    );
  } else if (!userId || !org) {
    title = "Your store has authorized consl";
    body = (
      <>
        <span className="font-medium text-ink">{pending.shop}</span> is ready to connect. Sign in, or create your consl account, to finish — the
        store attaches to your company and its products, stock and orders start importing.
      </>
    );
    actions = (
      <>
        <Link href={`/sign-in?redirect_url=${encodeURIComponent(CLAIM)}`} className={primaryCls}>
          Sign in
        </Link>
        <Link href={`/sign-up?redirect_url=${encodeURIComponent(CLAIM)}`} className={secondaryCls}>
          Create an account
        </Link>
      </>
    );
  } else if (role !== "owner") {
    title = "An owner has to attach the store";
    body = (
      <>
        <span className="font-medium text-ink">{pending.shop}</span> is ready to connect, but only an owner of {org.name} can attach a
        sales channel. Ask an owner to sign in here, or switch to a company you own from the sidebar and come back.
      </>
    );
    actions = (
      <Link href="/" className={primaryCls}>
        Open consl
      </Link>
    );
  } else if (current && current !== pending.shop) {
    title = `${org.name} already has a store`;
    body = (
      <>
        {org.name} is connected to <span className="font-medium text-ink">{current}</span>. Attaching{" "}
        <span className="font-medium text-ink">{pending.shop}</span> replaces that connection; everything already imported from {current}{" "}
        stays in this company&apos;s books. Connecting the new store to a different company? Switch company from the sidebar first, then
        come back here.
      </>
    );
    actions = (
      <>
        <a href={`${CLAIM}?replace=1`} className={dangerCls}>
          Replace with {pending.shop}
        </a>
        <Link href="/settings/integrations" className={secondaryCls}>
          Keep {current}
        </Link>
      </>
    );
  } else {
    title = "Your store has authorized consl";
    body = (
      <>
        Attach <span className="font-medium text-ink">{pending.shop}</span> to {org.name} to start importing its products, stock and orders.
        Nothing is written back to the store — consl only reads.
      </>
    );
    actions = (
      <a href={CLAIM} className={primaryCls}>
        Attach to {org.name}
      </a>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 p-6">
      <div className="w-full max-w-[440px] rounded-[var(--radius-card)] border border-border bg-surface p-7 shadow-sm">
        <span className="mb-4 flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-border bg-white p-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PROVIDER_LOGO.shopify} alt="" className="max-h-full max-w-full object-contain" />
        </span>
        <h1 className="text-[21px] font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{body}</p>
        <div className="mt-6 space-y-2.5">{actions}</div>
      </div>
    </div>
  );
}
