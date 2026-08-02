import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Plug, Lock, Check } from "@/components/icons";
import { Card } from "@/components/ui";
import { PROVIDERS, type Provider } from "@/lib/integrations";
import { getFmt } from "@/lib/fmt-server";
import { requireView } from "@/lib/membership";

export const dynamic = "force-dynamic";

/**
 * Integrations — the future home of per-tenant OAuth connections. The cards below are wired to
 * the same registry (lib/integrations.ts) the connect flow will use; until then Amazon may
 * already be live through the workspace's own API keys, and connecting any platform will
 * materialise its locked channel facilities automatically.
 */
export default async function IntegrationsSettingsPage() {
  await requireView("settings");
  const [lastSnapshot, channelFacilities, { date }] = await Promise.all([
    prisma.skuSnapshot.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
    prisma.facility.findMany({ where: { channel: { not: null } }, select: { channel: true, code: true } }),
    getFmt(),
  ]);
  const haveChannel = new Set(channelFacilities.map((f) => f.channel));

  // Amazon counts as connected today when the workspace-key sync has produced snapshots.
  const amazonLive = !!lastSnapshot;
  const status = (p: Provider): { text: string; live: boolean } =>
    p === "amazon" && amazonLive
      ? { text: `Connected · workspace API keys · last sync ${date(lastSnapshot!.capturedAt)}`, live: true }
      : { text: "Not connected", live: false };

  return (
    <div className="max-w-3xl space-y-3">
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
        const st = status(p);
        return (
          <Card key={p} className="flex flex-wrap items-center gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Plug size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14.5px] font-semibold text-ink">{def.label}</span>
                {st.live ? (
                  <span className="pill-green inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-medium leading-none">
                    <Check size={11} /> Active
                  </span>
                ) : (
                  <span className="pill-neutral inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-medium leading-none">
                    Coming soon
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
                <span className="text-[11px] text-muted">{st.text}</span>
              </div>
            </div>
            <button
              disabled
              title="Per-company connections arrive with the OAuth apps — coming soon"
              className="rounded-lg border border-border bg-surface px-3.5 py-2 text-[13px] font-medium text-ink-soft opacity-50"
            >
              {st.live ? "Manage" : "Connect"}
            </button>
          </Card>
        );
      })}
    </div>
  );
}
