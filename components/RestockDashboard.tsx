"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Paperclip } from "lucide-react";
import { money } from "@/lib/format";
import { SkuAvatar } from "@/components/ui";
import { syncAmazon } from "@/app/inventory/actions";
import type { RestockRow } from "@/lib/restock";

type Totals = {
  raw: number;
  inProduction: number;
  amazon: number;
  total: number;
  fbaUnits: number;
  inProductionUnits: number;
  reorderCount: number;
  avgCover: number;
};

const STATUS: Record<RestockRow["status"], { bg: string; fg: string; dot: string; label: string }> = {
  reorder: { bg: "#ffedd5", fg: "#9a3412", dot: "#ea580c", label: "Reorder" },
  watch: { bg: "#fef9c3", fg: "#854d0e", dot: "#ca8a04", label: "Watch" },
  ok: { bg: "#dcfce7", fg: "#166534", dot: "#16a34a", label: "Healthy" },
};

const n = (x: number) => x.toLocaleString("en-US");

export function RestockDashboard({ rows, totals, lastSync }: { rows: RestockRow[]; totals: Totals; lastSync: string | null }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  function sync() {
    setMsg(null);
    start(async () => {
      const r = await syncAmazon();
      if (!r.ok) setMsg(r.error);
      else setMsg(r.salesOk ? "Synced with Amazon." : "Inventory synced (sales report lagging — kept last velocity).");
      router.refresh();
    });
  }

  return (
    <div>
      {/* Total value + sync */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex-1 rounded-[var(--radius-card)] border border-accent-strong bg-accent-soft p-5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-accent">Total inventory value</div>
          <div className="mt-1 text-[38px] font-medium leading-none tracking-tight text-ink tabular">{money(totals.total)}</div>
          <div className="mt-3.5 flex flex-wrap gap-2">
            <ValuePill dot="#a3a3a3" label="Raw materials" value={money(totals.raw)} />
            <ValuePill dot="#171717" label="In production" value={money(totals.inProduction)} />
            <ValuePill dot="#2563eb" label="Amazon FBA" value={money(totals.amazon)} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={sync}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <RefreshCw size={14} className={pending ? "animate-spin" : ""} /> {pending ? "Syncing…" : "Sync Amazon"}
          </button>
          <span className="text-[11px] text-muted">{lastSync ? `Updated ${lastSync}` : "Never synced"}</span>
        </div>
      </div>
      {msg && <div className="mb-3 text-[12px] text-muted">{msg}</div>}

      {/* KPIs */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Kpi label="SKUs to reorder" value={String(totals.reorderCount)} tone={totals.reorderCount > 0 ? "#ea580c" : undefined} />
        <Kpi label="Amazon on-hand + inbound" value={n(totals.fbaUnits)} />
        <Kpi label="In production" value={n(totals.inProductionUnits)} />
        <Kpi label="Avg months cover" value={totals.avgCover.toFixed(1)} />
      </div>

      {/* SKU table */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink">By SKU</span>
        <div className="flex gap-3 text-[11px] text-muted">
          <Legend color="#171717" label="available" />
          <Legend color="#a3a3a3" label="inbound" />
          <Legend color="#d4d4d4" label="production" />
        </div>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        {rows.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-muted">No Amazon-mapped SKUs yet — hit Sync.</div>}
        {rows.map((r, i) => {
          const st = STATUS[r.status];
          const seg = (v: number, c: string) => (v > 0 ? <div style={{ width: `${(v / (r.position || 1)) * 100}%`, background: c }} /> : null);
          return (
            <div key={r.id} className={`grid grid-cols-[1.6fr_2fr_0.7fr_0.9fr_0.9fr] items-center gap-3 px-4 py-3 ${i < rows.length - 1 ? "border-b border-line" : ""}`}>
              <div className="flex min-w-0 items-center gap-2.5">
                <SkuAvatar code={r.code} imageUrl={r.imageUrl} size={30} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ink">{r.name}</div>
                  <div className="text-[11px] tabular text-muted">{n(Math.round(r.monthly))}/mo · 90-day</div>
                </div>
              </div>
              <div>
                <div className="flex h-2 overflow-hidden rounded-full bg-surface-2">
                  {seg(r.fbaAvailable, "#171717")}
                  {seg(r.fbaInbound, "#a3a3a3")}
                  {seg(r.inProduction, "#d4d4d4")}
                </div>
                <div className="mt-1.5 text-[11px] tabular text-muted">
                  {n(r.fbaAvailable)} avail · {n(r.fbaInbound)} inbound · {n(r.inProduction)} prod = <span className="font-medium text-ink">{n(r.position)}</span>
                </div>
              </div>
              <div className="tabular text-[16px] font-medium" style={{ color: r.status === "reorder" ? "#ea580c" : "#2563eb" }}>
                {r.cover >= 999 ? "∞" : r.cover.toFixed(1)}
                <span className="text-[11px] font-normal text-muted">mo</span>
              </div>
              <div>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                  style={{ background: st.bg, color: st.fg }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.dot }} /> {st.label}
                </span>
              </div>
              <div className="text-right">
                {r.status === "reorder" ? (
                  <div className="text-[12px]">
                    <div className="font-medium text-ink tabular">{r.recommendedQty > 0 ? `${n(r.recommendedQty)} units` : "Order"}</div>
                    <div className="text-[11px] text-muted">recommended</div>
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[12px] text-muted"><Paperclip size={11} className="opacity-0" />Covered</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ValuePill({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[13px]">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      {label} <span className="font-medium tabular text-ink">{value}</span>
    </span>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-0.5 text-[22px] font-medium tabular" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {label}
    </span>
  );
}
