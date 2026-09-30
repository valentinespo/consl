import Link from "next/link";
import { notFound } from "next/navigation";
import { requireView, getMyAccess } from "@/lib/membership";
import { getCurrentOrgId } from "@/lib/tenant";
import { loadXeroSetup } from "@/lib/xero-setup";
import { XeroSetupClient } from "@/components/xero/XeroSetupClient";
import { AlertTriangle, ChevronLeft } from "@/components/icons";

export const dynamic = "force-dynamic";

/**
 * The Xero export, opened from the P&L: link Xero, then choose where every P&L line and every
 * balance goes in the company's Xero chart of accounts.
 */
export default async function XeroExportPage() {
  await requireView("settings");
  const orgId = await getCurrentOrgId();
  if (!orgId) notFound();
  const [data, access] = await Promise.all([loadXeroSetup(orgId), getMyAccess()]);
  const canEdit = !!access?.can("settings", "edit");
  const orgName = data.state === "ready" ? data.orgName : data.state === "not_connected" ? null : data.orgName;

  return (
    <div className="mx-auto max-w-[940px]">
      <Link href="/pnl" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink-soft">
        <ChevronLeft size={13} /> P&amp;L
      </Link>
      <div className="mb-6 mt-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-white p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/integrations/xero.svg" alt="" className="max-h-full max-w-full object-contain" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[24px] font-medium tracking-tight text-ink">Xero export</h1>
            <p className="mt-0.5 truncate text-[13px] text-muted">
              {orgName ? (
                <>
                  Your consl P&amp;L, sent to <span className="font-medium text-ink-soft">{orgName}</span> in Xero.
                </>
              ) : (
                "Send your consl P&L to your Xero books."
              )}
            </p>
          </div>
        </div>
        {data.state === "ready" && (
          <Link href="/settings/integrations" className="text-[12.5px] font-medium text-muted hover:text-ink-soft">
            Connection settings
          </Link>
        )}
      </div>

      {data.state === "ready" ? (
        <XeroSetupClient data={data} canEdit={canEdit} />
      ) : (
        <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-border bg-surface px-6 py-12 text-center">
          {data.state !== "not_connected" && (
            <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-warn/10 text-warn">
              <AlertTriangle size={18} />
            </span>
          )}
          <h2 className="text-[16px] font-semibold text-ink">
            {data.state === "not_connected" ? "Link your Xero organisation" : data.state === "reconnect" ? "Reconnect Xero" : "Couldn't read your Xero accounts"}
          </h2>
          <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">
            {data.state === "not_connected"
              ? "consl sends your P&L to Xero once a month, into the accounts you choose. Link the Xero organisation that holds your books to start."
              : data.message}
          </p>
          <div className="mt-5">
            {data.state === "error" ? (
              <Link href="/pnl/xero" className="rounded-lg border border-border bg-surface px-3.5 py-2 text-[13px] font-medium text-ink-soft hover:bg-surface-2">
                Try again
              </Link>
            ) : canEdit && access?.role === "owner" ? (
              <a href="/api/integrations/xero/connect" className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-bg hover:opacity-90">
                {data.state === "not_connected" ? "Link with Xero" : "Reconnect Xero"}
              </a>
            ) : (
              <span className="text-[12.5px] text-muted">Ask an owner of this company to link Xero.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
