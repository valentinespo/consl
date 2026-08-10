"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "@/components/icons";
import { useMoney } from "@/components/CurrencyProvider";
import { importOrders, setSourceExcluded } from "@/app/orders/actions";
import type { OrdersOverview } from "@/lib/order-metrics";

const CHANNEL_LOGO: Record<string, string> = {
  AMAZON: "/integrations/amazon-fba.png",
  SHOPIFY: "/integrations/shopify.png",
  TIKTOK: "/integrations/tiktok.png",
};

const PILL = "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium";

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => onChange(!on)}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-accent-strong" : "bg-border"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

export function OrdersClient({ overview, canImport }: { overview: OrdersOverview; canImport: boolean }) {
  const router = useRouter();
  const { money } = useMoney();
  const [importing, startImport] = useTransition();
  const [savingSource, setSavingSource] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function runImport() {
    setMsg(null);
    startImport(async () => {
      const r = await importOrders();
      setMsg(r.ok ? `Imported ${r.summary}.` : r.error ?? "Import failed.");
      router.refresh();
    });
  }

  function toggleSource(source: string, excluded: boolean) {
    setSavingSource(source);
    void setSourceExcluded(source, excluded).then(() => {
      router.refresh();
      setSavingSource(null);
    });
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="flex flex-col gap-5">
      {/* Header: totals + import */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-6">
          <Stat label="Orders" value={overview.totalOrders.toLocaleString()} />
          <Stat label="Units sold" value={overview.totalUnits.toLocaleString()} />
          <Stat label="Revenue" value={money(overview.totalRevenue)} />
        </div>
        {canImport && (
          <div className="flex items-center gap-2.5">
            {msg && <span className="hidden text-[11.5px] text-muted sm:inline">{msg}</span>}
            <button
              onClick={runImport}
              disabled={importing}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <RefreshCw size={14} className={importing ? "animate-spin" : ""} />
              {importing ? "Importing…" : "Import orders"}
            </button>
          </div>
        )}
      </div>

      {/* Per-channel split */}
      {overview.channels.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {overview.channels.map((c) => (
            <div key={c.channel} className="rounded-[var(--radius-card)] border border-border bg-surface-2/40 p-4">
              <div className="mb-2 flex items-center gap-2">
                {CHANNEL_LOGO[c.channel] && (
                  <Image src={CHANNEL_LOGO[c.channel]} alt="" width={18} height={18} className="rounded-[4px]" />
                )}
                <span className="text-[13px] font-medium text-ink">{c.label}</span>
              </div>
              <div className="text-[19px] font-semibold text-ink">{money(c.revenue)}</div>
              <div className="mt-0.5 text-[12px] text-muted">
                {c.orders.toLocaleString()} orders · {c.units.toLocaleString()} units
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Exclusion settings strip — only when a mirrored source exists */}
      {overview.sources.length > 0 && (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface-2/40 p-4">
          <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Avoid double-counting</div>
          <p className="mt-1 max-w-[70ch] text-[12.5px] text-muted">
            These channels also record their orders inside Shopify. Turn one on to count those sales
            from the channel itself instead of Shopify, so they aren&apos;t counted twice.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {overview.sources.map((s) => (
              <div key={s.source} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2">
                <div className="min-w-0">
                  <span className="text-[13px] font-medium text-ink">{s.label} orders in Shopify</span>
                  <span className="ml-2 text-[11.5px] text-muted">{s.count.toLocaleString()} found</span>
                </div>
                <Toggle on={s.excluded} disabled={savingSource === s.source} onChange={(v) => toggleSource(s.source, v)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent orders */}
      {overview.recent.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface-2/40 px-6 py-10 text-center">
          <div className="text-[14px] font-semibold text-ink">No orders yet</div>
          <p className="mt-1 text-[12.5px] text-muted">
            {canImport ? "Hit “Import orders” to pull your order history." : "Connect a sales channel to see orders here."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-border bg-surface-2/50 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted">
            <span>Order</span>
            <span className="text-right">Units</span>
            <span className="text-right">Total</span>
            <span className="text-right">Date</span>
          </div>
          {overview.recent.map((o) => (
            <div
              key={o.id}
              className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-0 ${
                o.excluded || o.cancelled ? "opacity-45" : ""
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {CHANNEL_LOGO[o.channel] && (
                  <Image src={CHANNEL_LOGO[o.channel]} alt="" width={16} height={16} className="shrink-0 rounded-[3px]" />
                )}
                <span className="truncate text-ink">{o.channelLabel}</span>
                {o.sourceLabel && o.sourceLabel !== o.channelLabel && (
                  <span className="truncate text-[12px] text-muted">· {o.sourceLabel}</span>
                )}
                {o.excluded && <span className={`${PILL} pill-neutral`}>not counted</span>}
                {o.cancelled && <span className={`${PILL} pill-red`}>cancelled</span>}
              </div>
              <span className="text-right tabular text-ink-soft">{o.units.toLocaleString()}</span>
              <span className="text-right tabular text-ink-soft">{money(o.total)}</span>
              <span className="text-right text-[12px] text-muted">{fmtDate(o.orderedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold tabular text-ink">{value}</div>
    </div>
  );
}
