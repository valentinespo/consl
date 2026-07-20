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

// Green scale for the "available now / available soon" buckets; AWD blue; production amber.
const SEG = {
  available: "#16a34a", // green — sellable now
  inbound: "#4ade80", // soft green — inbound to FBA (available soon)
  reserved: "#bbf7d0", // lighter green — reserved / in-transit between FCs
  awd: "#2563eb", // blue — AWD warehouse
  production: "#f59e0b", // amber — in production
};

type Status = "reorder" | "watch" | "ok" | "reordered";
const STATUS: Record<Status, { bg: string; fg: string; dot: string; label: string }> = {
  reorder: { bg: "#ffedd5", fg: "#9a3412", dot: "#ea580c", label: "Reorder" },
  watch: { bg: "#fef9c3", fg: "#854d0e", dot: "#ca8a04", label: "Watch" },
  ok: { bg: "#dcfce7", fg: "#166534", dot: "#16a34a", label: "Healthy" },
  reordered: { bg: "#dcfce7", fg: "#166534", dot: "#16a34a", label: "Reordered" },
};

const n = (x: number) => Math.round(x).toLocaleString("en-US");

type Computed = RestockRow & { monthly: number; cover: number; status: Status; recommendedQty: number; effPosition: number; note?: string };

function compute(r: RestockRow, days: Win, inclProd: boolean): Computed {
  const units = days === 10 ? r.units10d : days === 30 ? r.units30d : r.units90d;
  const monthly = units > 0 ? (units / days) * MONTH : 0;
  const availPos = r.fbaTotal + r.awdTotal;
  const fullPos = availPos + r.inProduction;
  const effPosition = inclProd ? fullPos : availPos;
  const cover = monthly > 0 ? effPosition / monthly : effPosition > 0 ? Infinity : 0;
  const fullCover = monthly > 0 ? fullPos / monthly : fullPos > 0 ? Infinity : 0;
  const hasProduction = r.inProduction > 0;
  // Production counts as incoming supply: order more only if even production won't hold the floor.
  const needsOrder = fullCover < r.minMonths;

  let status: Status;
  let note: string | undefined;
  let recommendedQty = 0;
  if (needsOrder) {
    status = "reorder";
    const raw = Math.max(0, Math.ceil(r.reorderToMonths * monthly - fullPos));
    recommendedQty = r.batchSize > 0 && raw > 0 ? Math.ceil(raw / r.batchSize) * r.batchSize : raw;
    if (hasProduction) note = "reorder placed · still short";
  } else if (!inclProd && hasProduction) {
    status = "reordered"; // available is low, but a production order already covers the floor
  } else {
    status = cover < r.minMonths * 1.3 ? "watch" : "ok";
  }
  return { ...r, monthly, cover, status, recommendedQty, effPosition, note };
}

export function RestockDashboard({ rows, totals, lastSync }: { rows: RestockRow[]; totals: RestockTotals; lastSync: string | null }) {
  const [win, setWin] = useState<Win>(90);
  const [inclProd, setInclProd] = useState(true);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  const computed = useMemo(() => rows.map((r) => compute(r, win, inclProd)).sort((a, b) => b.monthly - a.monthly), [rows, win, inclProd]);
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
            <ValuePill dot={SEG.available} label="FBA" value={money(totals.fba)} />
            <ValuePill dot={SEG.awd} label="AWD" value={money(totals.awd)} />
            <ValuePill dot={SEG.production} label="In production" value={money(totals.inProduction)} />
            <ValuePill dot="#94a3b8" label="Raw materials" value={money(totals.raw)} />
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

      {/* Controls + legend */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
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
          <button onClick={() => setInclProd((v) => !v)} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink-soft">
            <span className={`relative h-4 w-7 rounded-full transition-colors ${inclProd ? "bg-accent" : "bg-border"}`}>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${inclProd ? "left-3.5" : "left-0.5"}`} />
            </span>
            Include production
          </button>
        </div>
        <div className="flex flex-wrap gap-2.5 text-[11px] text-muted">
          <Legend color={SEG.available} label="available" />
          <Legend color={SEG.inbound} label="inbound" />
          <Legend color={SEG.reserved} label="reserved" />
          <Legend color={SEG.awd} label="AWD" />
          {inclProd && <Legend color={SEG.production} label="production" />}
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        {computed.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-muted">No Amazon-mapped SKUs yet — hit Sync.</div>}
        {computed.map((r, i) => {
          const st = STATUS[r.status];
          const seg = (v: number, c: string) => (v > 0 ? <div key={c} style={{ width: `${(v / (r.effPosition || 1)) * 100}%`, background: c }} /> : null);
          const parts = [
            r.fbaAvailable && `${n(r.fbaAvailable)} avail`,
            r.fbaInbound && `${n(r.fbaInbound)} inbound`,
            r.fbaReserved && `${n(r.fbaReserved)} reserved`,
            r.awdTotal && `${n(r.awdTotal)} AWD`,
            inclProd && r.inProduction && `${n(r.inProduction)} prod`,
          ].filter(Boolean);
          return (
            <div key={r.id} className={`grid grid-cols-[1.5fr_2.2fr_0.7fr_0.9fr_0.9fr] items-center gap-3 px-4 py-3 ${i < computed.length - 1 ? "border-b border-line" : ""}`}>
              <div className="flex min-w-0 items-center gap-2.5">
                <SkuAvatar code={r.code} imageUrl={r.imageUrl} size={30} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ink">{r.name}</div>
                  <div className="text-[11px] tabular text-muted">{n(r.monthly)}/mo · {win}-day</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-[62px] shrink-0 text-right">
                  <div className="text-[19px] font-medium leading-none tabular text-ink">{n(r.effPosition)}</div>
                  <div className="text-[10px] text-muted">units</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
                    {seg(r.fbaAvailable, SEG.available)}
                    {seg(r.fbaInbound, SEG.inbound)}
                    {seg(r.fbaReserved, SEG.reserved)}
                    {seg(r.awdTotal, SEG.awd)}
                    {inclProd && seg(r.inProduction, SEG.production)}
                  </div>
                  <div className="mt-1.5 truncate text-[11px] tabular text-muted">{parts.join(" · ")}</div>
                </div>
              </div>
              <div className="tabular text-[16px] font-medium" style={{ color: r.status === "reorder" ? "#ea580c" : r.status === "reordered" || r.status === "ok" ? "#16a34a" : "#2563eb" }}>
                {r.cover === Infinity ? "∞" : r.cover.toFixed(1)}
                <span className="text-[11px] font-normal text-muted">mo</span>
              </div>
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: st.bg, color: st.fg }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.dot }} /> {st.label}
                </span>
                {r.note && <div className="mt-0.5 text-[10px] text-muted">{r.note}</div>}
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
