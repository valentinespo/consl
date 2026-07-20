"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { money } from "@/lib/format";
import { SkuAvatar } from "@/components/ui";
import { syncAmazon } from "@/app/inventory/actions";
import type { RestockRow, RestockTotals } from "@/lib/restock";

const MONTH = 30.44;
const WINDOWS = [10, 30, 90] as const;
type Win = (typeof WINDOWS)[number];

// Distinct, visible segment colors
const SEG = {
  available: "#16a34a", // green — sellable now
  inbound: "#2563eb", // blue — inbound to FBA
  reserved: "#94a3b8", // slate — reserved / in-transit between FCs
  awd: "#8b5cf6", // violet — AWD warehouse
  production: "#f59e0b", // amber — in production
};

const STATUS: Record<"reorder" | "watch" | "ok", { bg: string; fg: string; dot: string; label: string }> = {
  reorder: { bg: "#ffedd5", fg: "#9a3412", dot: "#ea580c", label: "Reorder" },
  watch: { bg: "#fef9c3", fg: "#854d0e", dot: "#ca8a04", label: "Watch" },
  ok: { bg: "#dcfce7", fg: "#166534", dot: "#16a34a", label: "Healthy" },
};

const n = (x: number) => Math.round(x).toLocaleString("en-US");

type Computed = RestockRow & { monthly: number; cover: number; status: "reorder" | "watch" | "ok"; recommendedQty: number };

function compute(r: RestockRow, days: Win): Computed {
  const units = days === 10 ? r.units10d : days === 30 ? r.units30d : r.units90d;
  const monthly = units > 0 ? (units / days) * MONTH : 0;
  const cover = monthly > 0 ? r.position / monthly : r.position > 0 ? Infinity : 0;
  const status = cover < r.minMonths ? "reorder" : cover < r.minMonths * 1.3 ? "watch" : "ok";
  let recommendedQty = 0;
  if (status === "reorder") {
    const raw = Math.max(0, Math.ceil(r.reorderToMonths * monthly - r.position));
    recommendedQty = r.batchSize > 0 && raw > 0 ? Math.ceil(raw / r.batchSize) * r.batchSize : raw;
  }
  return { ...r, monthly, cover, status, recommendedQty };
}

export function RestockDashboard({ rows, totals, lastSync }: { rows: RestockRow[]; totals: RestockTotals; lastSync: string | null }) {
  const [win, setWin] = useState<Win>(90);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  const computed = useMemo(() => rows.map((r) => compute(r, win)).sort((a, b) => a.cover - b.cover), [rows, win]);
  const reorderCount = computed.filter((r) => r.status === "reorder").length;
  const avgCover = computed.length ? computed.reduce((s, r) => s + Math.min(r.cover, 60), 0) / computed.length : 0;

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
            <ValuePill dot="#94a3b8" label="Raw materials" value={money(totals.raw)} />
            <ValuePill dot={SEG.production} label="In production" value={money(totals.inProduction)} />
            <ValuePill dot={SEG.inbound} label="Amazon (FBA + AWD)" value={money(totals.amazon)} />
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
        <Kpi label="SKUs to reorder" value={String(reorderCount)} tone={reorderCount > 0 ? "#ea580c" : undefined} />
        <Kpi label="Amazon (FBA + AWD)" value={n(totals.fbaUnits + totals.awdUnits)} />
        <Kpi label="In production" value={n(totals.inProductionUnits)} />
        <Kpi label="Avg months cover" value={avgCover >= 60 ? "60+" : avgCover.toFixed(1)} />
      </div>

      {/* Window toggle + legend */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-ink">By SKU</span>
          <div className="flex gap-0.5 rounded-lg border border-border bg-surface p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setWin(w)}
                className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  win === w ? "bg-accent-soft text-accent" : "text-muted hover:text-ink-soft"
                }`}
              >
                {w}d
              </button>
            ))}
          </div>
          <span className="text-[11px] text-muted">velocity window</span>
        </div>
        <div className="flex flex-wrap gap-2.5 text-[11px] text-muted">
          <Legend color={SEG.available} label="available" />
          <Legend color={SEG.inbound} label="inbound" />
          <Legend color={SEG.reserved} label="reserved" />
          <Legend color={SEG.awd} label="AWD" />
          <Legend color={SEG.production} label="production" />
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        {computed.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-muted">No Amazon-mapped SKUs yet — hit Sync.</div>}
        {computed.map((r, i) => {
          const st = STATUS[r.status];
          const seg = (v: number, c: string) => (v > 0 ? <div key={c} style={{ width: `${(v / (r.position || 1)) * 100}%`, background: c }} /> : null);
          const parts = [
            r.fbaAvailable && `${n(r.fbaAvailable)} avail`,
            r.fbaInbound && `${n(r.fbaInbound)} inbound`,
            r.fbaReserved && `${n(r.fbaReserved)} reserved`,
            r.awdTotal && `${n(r.awdTotal)} AWD`,
            r.inProduction && `${n(r.inProduction)} prod`,
          ].filter(Boolean);
          return (
            <div key={r.id} className={`grid grid-cols-[1.6fr_2fr_0.7fr_0.9fr_0.9fr] items-center gap-3 px-4 py-3 ${i < computed.length - 1 ? "border-b border-line" : ""}`}>
              <div className="flex min-w-0 items-center gap-2.5">
                <SkuAvatar code={r.code} imageUrl={r.imageUrl} size={30} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ink">{r.name}</div>
                  <div className="text-[11px] tabular text-muted">{n(r.monthly)}/mo · {win}-day</div>
                </div>
              </div>
              <div>
                <div className="flex h-2 overflow-hidden rounded-full bg-surface-2">
                  {seg(r.fbaAvailable, SEG.available)}
                  {seg(r.fbaInbound, SEG.inbound)}
                  {seg(r.fbaReserved, SEG.reserved)}
                  {seg(r.awdTotal, SEG.awd)}
                  {seg(r.inProduction, SEG.production)}
                </div>
                <div className="mt-1.5 text-[11px] tabular text-muted">
                  {parts.join(" · ")} = <span className="font-medium text-ink">{n(r.position)}</span>
                </div>
              </div>
              <div className="tabular text-[16px] font-medium" style={{ color: r.status === "reorder" ? "#ea580c" : "#2563eb" }}>
                {r.cover === Infinity ? "∞" : r.cover.toFixed(1)}
                <span className="text-[11px] font-normal text-muted">mo</span>
              </div>
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: st.bg, color: st.fg }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.dot }} /> {st.label}
                </span>
              </div>
              <div className="text-right">
                {r.status === "reorder" ? (
                  <div className="text-[12px]">
                    <div className="font-medium tabular text-ink">{r.recommendedQty > 0 ? `${n(r.recommendedQty)} units` : "Order"}</div>
                    <div className="text-[11px] text-muted">recommended</div>
                  </div>
                ) : (
                  <span className="text-[12px] text-muted">Covered</span>
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
