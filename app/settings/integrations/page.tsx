import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Plug, Lock, Check, AlertTriangle } from "@/components/icons";
import { Card } from "@/components/ui";
import { PROVIDERS, type Provider } from "@/lib/integrations";
import { IntegrationControls } from "@/components/IntegrationControls";
import { amazonOAuthConfigured } from "@/lib/amazon-oauth";
import { getFmt } from "@/lib/fmt-server";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

/**
 * Integrations — per-tenant OAuth connections. Amazon is live (connect via the SP-API OAuth flow).
 * Shopify/TikTok are registered but their data isn't modelled yet, so they stay "coming soon".
 */
export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireView("settings");
  const sp = await searchParams;
  const [integrations, lastSnapshot, channelFacilities, { date }] = await Promise.all([
    prisma.integration.findMany(),
    prisma.skuSnapshot.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
    prisma.facility.findMany({ where: { channel: { not: null } }, select: { channel: true } }),
    getFmt(),
  ]);
  const byProvider = new Map(integrations.map((i) => [i.provider, i]));
  const haveChannel = new Set(channelFacilities.map((f) => f.channel));
  const amazonReady = amazonOAuthConfigured();

  const connected = (sp.connected as string) || null;
  const error = (sp.error as string) || null;

  // Amazon "live" via a real per-tenant connection, or (legacy) the workspace-key sync that's
  // produced snapshots. Only providers with modelled data can connect.
  const CONNECTABLE: Record<Provider, boolean> = { amazon: amazonReady, shopify: false, tiktok: false };

  return (
    <div className="max-w-3xl space-y-3">
      {connected && (
        <div className="flex items-center gap-2 rounded-lg border border-positive/25 bg-positive/10 px-3 py-2 text-[12.5px] text-positive">
          <Check size={14} /> {PROVIDERS[connected as Provider]?.label ?? connected} connected.
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-[#f0d3cb] bg-[#fdf2ef] px-3 py-2 text-[12.5px] text-negative">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <p className="text-[13px] leading-relaxed text-muted">
        Connecting a platform pulls its stock and sales into consl and creates a locked{" "}
        <Link href="/facilities" className="font-medium text-accent hover:underline">
          facility
        </Link>{" "}
        for each of its channels — so channel inventory has a real place in your facility model. Managed facilities
        can&apos;t be edited or deleted; they belong to the connection.
      </p>

      {(Object.keys(PROVIDERS) as Provider[]).map((p) => {
        const def = PROVIDERS[p];
        const row = byProvider.get(p);
        const liveConn = row?.status === "connected";
        const legacyAmazon = p === "amazon" && !row && !!lastSnapshot;
        const isConnected = liveConn || legacyAmazon;
        const statusText = liveConn
          ? `Connected${row?.lastSyncAt ? ` · last sync ${date(row.lastSyncAt)}` : row?.connectedAt ? ` · ${date(row.connectedAt)}` : ""}`
          : legacyAmazon
            ? `Connected · workspace keys · last sync ${date(lastSnapshot!.capturedAt)}`
            : CONNECTABLE[p]
              ? "Not connected"
              : "Coming soon";

        return (
          <Card key={p} className="flex flex-wrap items-center gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Plug size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14.5px] font-semibold text-ink">{def.label}</span>
                {isConnected ? (
                  <span className="pill-green inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-medium leading-none">
                    <Check size={11} /> Active
                  </span>
                ) : (
                  <span className="pill-neutral inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-medium leading-none">
                    {CONNECTABLE[p] ? "Available" : "Coming soon"}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[12.5px] text-muted">{def.blurb}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {def.facilities.map((f) => (
                  <span
                    key={f.channel}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-soft"
                    title={`${f.name} — created as a locked facility when ${def.label} connects`}
                  >
                    <Lock size={10} className="text-muted" /> {f.code}
                    {haveChannel.has(f.channel) && <Check size={11} className="text-positive" />}
                  </span>
                ))}
                <span className="text-[11px] text-muted">{statusText}</span>
              </div>
            </div>
            {/* Disconnect only for a real per-tenant connection; a legacy (workspace-key) Amazon
                still offers Connect so the seller can establish the real OAuth connection. */}
            <IntegrationControls provider={p} connected={liveConn} canConnect={CONNECTABLE[p]} />
          </Card>
        );
      })}
    </div>
  );
}
