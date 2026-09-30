import Link from "next/link";
import { getCurrentOrgId } from "@/lib/tenant";
import { getMyAccess } from "@/lib/membership";
import { xeroExportStatus } from "@/lib/xero-setup";

const pillCls = "inline-flex items-center rounded-full border px-1.5 py-[1px] text-[10.5px] font-medium";

/** The P&L's way into the Xero export: link Xero, finish the setup, or open it. */
export async function XeroPnlButton() {
  const access = await getMyAccess();
  if (!access?.can("settings", "view")) return null;
  const orgId = await getCurrentOrgId();
  if (!orgId) return null;
  const status = await xeroExportStatus(orgId).catch(() => "not_connected" as const);
  return (
    <Link
      href="/pnl/xero"
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] font-medium text-ink-soft hover:bg-surface-2"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/integrations/xero.svg" alt="" className="h-4 w-4" />
      {status === "not_connected" ? "Link with Xero" : "Xero"}
      {status === "setup" && <span className={`pill-amber ${pillCls}`}>Set up</span>}
      {status === "reconnect" && <span className={`pill-red ${pillCls}`}>Reconnect</span>}
      {status === "ready" && <span className={`pill-green ${pillCls}`}>Ready</span>}
    </Link>
  );
}
