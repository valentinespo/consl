"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Settings2, Check, GripVertical } from "lucide-react";
import { money } from "@/lib/format";
import { SkuAvatar } from "@/components/ui";
import { syncAmazon, updateGlobalDefaults, updateSkuPolicy, setSortMode, saveManualOrder } from "@/app/inventory/actions";
import type { RestockRow, RestockTotals } from "@/lib/restock";

type SortMode = "sales" | "available" | "manual";
const SORT_LABEL: Record<SortMode, string> = { sales: "Monthly sales", available: "Units available", manual: "Manual" };

const MONTH = 30.44;
const MONTH_MS = MONTH * 86_400_000;
const WINDOWS = [10, 30, 90] as const;
type Win = (typeof WINDOWS)[number];

const SEG = {
  available: "#16a34a",
  inbound: "#4ade80",
  reserved: "#bbf7d0",
  awd: "#2563eb",
  production: "#f59e0b",
};

type Status = "ok" | "reordered" | "reorder" | "oos";
const STATUS: Record<Status, { bg: string; fg: string; dot: string; label: string }> = {
  ok: { bg: "#dcfce7", fg: "#166534", dot: "#16a34a", label: "Healthy" },
  reordered: { bg: "#dcfce7", fg: "#166534", dot: "#16a34a", label: "Reordered" },
  reorder: { bg: "#ffedd5", fg: "#9a3412", dot: "#ea580c", label: "Reorder" },
  oos: { bg: "#fee2e2", fg: "#b91c1c", dot: "#dc2626", label: "OOS" },
};

const n = (x: number) => Math.round(x).toLocaleString("en-US");
const mo = (x: number) => (x === Infinity ? "∞" : x.toFixed(1));

type Computed = RestockRow & {
  monthly: number;
  onHandCover: number;
  prodCover: number;
  status: Status;
  statusLabel: string;
  note?: string;
  recommendedQty: number;
  belowFloor: boolean; // total supply (on-hand + production) below the floor → genuinely needs a new PO
};

function compute(r: RestockRow, days: Win, nowMs: number): Computed {
  const units = days === 10 ? r.units10d : days === 30 ? r.units30d : r.units90d;
  const salesDays = days === 10 ? r.salesDays10 : days === 30 ? r.salesDays30 : r.salesDays90;
  const monthly = salesDays > 0 ? (units / salesDays) * MONTH : 0; // velocity over in-stock (selling) days
  const A = monthly > 0 ? r.onHand / monthly : r.onHand > 0 ? Infinity : 0;
  const P = monthly > 0 ? r.inProduction / monthly : r.inProduction > 0 ? Infinity : 0;
  const hasPO = r.inProduction > 0;
  const total = A + P;

  // Time until the soonest lot lands (PO date + lead), and whether it's overdue.
  let Tc = 0;
  let overdue = false;
  if (hasPO && r.soonestPoISO) {
    const t = (new Date(r.soonestPoISO).getTime() + r.leadMonths * MONTH_MS - nowMs) / MONTH_MS;
    overdue = t < 0;
    Tc = Math.max(0, t);
  }

  let status: Status = "ok";
  let statusLabel = STATUS.ok.label;
  let note: string | undefined;
  let recommendedQty = 0;

  if (monthly === 0) {
    status = "ok";
    statusLabel = "Healthy";
  } else if (hasPO) {
    if (A < Tc) {
      status = "oos";
      statusLabel = `OOS for ${Math.round((Tc - A) * MONTH)}d`;
    } else if (total >= r.minMonths) {
      status = "reordered";
      statusLabel = "Reordered";
    } else {
      status = "reorder";
      statusLabel = "Reorder";
      if (total < r.leadMonths) note = `off by ${Math.round((r.leadMonths - total) * MONTH)}d`;
    }
  } else {
    if (A >= r.minMonths) {
      status = "ok";
      statusLabel = "Healthy";
    } else {
      status = "reorder";
      statusLabel = "Reorder";
      if (A < r.leadMonths) note = `off by ${Math.round((r.leadMonths - A) * MONTH)}d`;
    }
  }
  if (overdue) note = note ? `${note} · production overdue` : "production overdue";
  // A new PO is only warranted when total supply (on-hand + production) is under the floor.
  // If production already covers the floor, an OOS gap is a timing problem → expedite, don't order.
  const belowFloor = monthly > 0 && total < r.minMonths;
  if (belowFloor) {
    const raw = Math.max(0, Math.ceil(r.reorderToMonths * monthly - r.onHand - r.inProduction));
    recommendedQty = r.batchSize > 0 && raw > 0 ? Math.ceil(raw / r.batchSize) * r.batchSize : raw;
  }
  return { ...r, monthly, onHandCover: A, prodCover: P, status, statusLabel, note, recommendedQty, belowFloor };
}

export function RestockDashboard({
  rows,
  totals,
  lastSync,
  defaults,
  sortMode: initialSort,
  nowMs,
}: {
  rows: RestockRow[];
  totals: RestockTotals;
  lastSync: string | null;
  defaults: { minMonths: number; leadMonths: number };
  sortMode: string;
  nowMs: number;
}) {
  const [win, setWin] = useState<Win>(90);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [editSku, setEditSku] = useState<string | null>(null);
  const [editGlobal, setEditGlobal] = useState(false);
  const [sort, setSort] = useState<SortMode>((["sales", "available", "manual"].includes(initialSort) ? initialSort : "sales") as SortMode);
  const [arranging, setArranging] = useState(false); // manual drag mode active
  const [order, setOrder] = useState<string[]>([]); // ids during manual arranging
  const dragId = useRef<string | null>(null);
  const router = useRouter();

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, compute(r, win, nowMs)])), [rows, win, nowMs]);
  const computed = useMemo(() => {
    const arr = [...byId.values()];
    if (sort === "available") arr.sort((a, b) => b.onHand - a.onHand);
    else if (sort === "manual") arr.sort((a, b) => (a.sortIndex ?? 9999) - (b.sortIndex ?? 9999) || b.monthly - a.monthly);
    else arr.sort((a, b) => b.monthly - a.monthly);
    return arr;
  }, [byId, sort]);
  const displayRows = arranging ? order.map((id) => byId.get(id)).filter((r): r is Computed => !!r) : computed;
  const reorderCount = computed.filter((r) => r.belowFloor).length;
  const avgCover = computed.length ? computed.reduce((s, r) => s + Math.min(r.onHandCover, 60), 0) / computed.length : 0;

  function pickSort(m: SortMode) {
    setSort(m);
    if (m === "manual") {
      setOrder(computed.map((r) => r.id));
      setArranging(true);
    } else {
      setArranging(false);
      start(async () => { await setSortMode(m); router.refresh(); });
    }
  }
  function confirmOrder() {
    setArranging(false);
    start(async () => { await saveManualOrder(order); router.refresh(); });
  }
  function onDragOver(overId: string) {
    const from = dragId.current;
    if (!from || from === overId) return;
    setOrder((prev) => {
      const a = [...prev];
      const fi = a.indexOf(from);
      const ti = a.indexOf(overId);
      if (fi < 0 || ti < 0) return prev;
      a.splice(fi, 1);
      a.splice(ti, 0, from);
      return a;
    });
  }

  function sync() {
    setMsg(null);
    start(async () => {
      const r = await syncAmazon();
      setMsg(r.ok ? (r.salesOk ? "Synced with Amazon." : "Inventory synced (sales lagging — kept last velocity).") : r.error);
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
          <button onClick={sync} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60">
            <RefreshCw size={14} className={pending ? "animate-spin" : ""} /> {pending ? "Syncing…" : "Sync Amazon"}
          </button>
          <span className="text-[11px] text-muted">{lastSync ? `Updated ${lastSync}` : "Never synced"}</span>
        </div>
      </div>
      {msg && <div className="mb-3 text-[12px] text-muted">{msg}</div>}

      {/* KPIs */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Kpi label="Needs a PO" value={String(reorderCount)} tone={reorderCount > 0 ? "#ea580c" : undefined} />
        <Kpi label="Amazon (FBA + AWD)" value={n(totals.fbaUnits + totals.awdUnits)} />
        <Kpi label="In production" value={n(totals.inProductionUnits)} />
        <Kpi label="Avg on-hand cover" value={avgCover >= 60 ? "60+" : avgCover.toFixed(1)} />
      </div>

      {/* Controls */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] font-medium text-ink">By SKU</span>
          <div className="flex gap-0.5 rounded-lg border border-border bg-surface p-0.5">
            {WINDOWS.map((w) => (
              <button key={w} onClick={() => setWin(w)} className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${win === w ? "bg-accent-soft text-accent" : "text-muted hover:text-ink-soft"}`}>
                {w}d
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted">sort</span>
            <div className="flex gap-0.5 rounded-lg border border-border bg-surface p-0.5">
              {(["sales", "available", "manual"] as SortMode[]).map((m) => (
                <button key={m} onClick={() => pickSort(m)} className={`rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${sort === m && !arranging ? "bg-accent-soft text-accent" : arranging && m === "manual" ? "bg-accent-soft text-accent" : "text-muted hover:text-ink-soft"}`}>
                  {m === "sales" ? "Sales" : m === "available" ? "Available" : "Manual"}
                </button>
              ))}
            </div>
            {arranging && (
              <button onClick={confirmOrder} disabled={pending} className="inline-flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-60">
                <Check size={13} /> Done
              </button>
            )}
          </div>
          <button onClick={() => setEditGlobal((v) => !v)} className="inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-ink-soft">
            <Settings2 size={12} /> floor {defaults.minMonths}mo · lead {defaults.leadMonths}mo
          </button>
        </div>
        <div className="flex flex-wrap gap-2.5 text-[11px] text-muted">
          <Legend color={SEG.available} label="available" />
          <Legend color={SEG.inbound} label="inbound" />
          <Legend color={SEG.reserved} label="reserved" />
          <Legend color={SEG.awd} label="AWD" />
          <Legend color={SEG.production} label="production" />
        </div>
      </div>

      {editGlobal && (
        <GlobalDefaultsEditor
          defaults={defaults}
          pending={pending}
          onSave={(f, l) => start(async () => { await updateGlobalDefaults(f, l); setEditGlobal(false); router.refresh(); })}
          onClose={() => setEditGlobal(false)}
        />
      )}

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        {displayRows.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-muted">No Amazon-mapped SKUs yet — hit Sync.</div>}
        {displayRows.map((r, i) => {
          const st = STATUS[r.status];
          const totalUnits = r.onHand + r.inProduction;
          const seg = (v: number, c: string) => (v > 0 ? <div key={c} style={{ width: `${(v / (totalUnits || 1)) * 100}%`, background: c }} /> : null);
          const parts = [
            r.fbaAvailable && `${n(r.fbaAvailable)} avail`,
            r.fbaInbound && `${n(r.fbaInbound)} inbound`,
            r.fbaReserved && `${n(r.fbaReserved)} reserved`,
            r.awdTotal && `${n(r.awdTotal)} AWD`,
            r.inProduction && `${n(r.inProduction)} prod`,
          ].filter(Boolean);
          return (
            <div
              key={r.id}
              draggable={arranging}
              onDragStart={() => { dragId.current = r.id; }}
              onDragOver={(e) => { if (arranging) { e.preventDefault(); onDragOver(r.id); } }}
              onDragEnd={() => { dragId.current = null; }}
              className={arranging ? "cursor-grab active:cursor-grabbing" : ""}
            >
              <div className={`grid grid-cols-[minmax(180px,1.4fr)_84px_minmax(0,1.7fr)_112px_128px_112px] items-center gap-4 px-4 py-3 ${i < displayRows.length - 1 && editSku !== r.id ? "border-b border-line" : ""}`}>
                {/* SKU */}
                <div className="flex min-w-0 items-center gap-2.5">
                  {arranging && <GripVertical size={16} className="shrink-0 text-muted" />}
                  <SkuAvatar code={r.code} imageUrl={r.imageUrl} size={32} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-ink">{r.name}</div>
                    <div className="text-[11px] tabular text-muted">{n(r.monthly)}/mo · {win}-day</div>
                  </div>
                </div>
                {/* Total units */}
                <div>
                  <div className="text-[15px] font-medium leading-none tabular text-ink">{n(totalUnits)}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">units</div>
                </div>
                {/* Pipeline bar */}
                <div className="min-w-0">
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
                    {seg(r.fbaAvailable, SEG.available)}
                    {seg(r.fbaInbound, SEG.inbound)}
                    {seg(r.fbaReserved, SEG.reserved)}
                    {seg(r.awdTotal, SEG.awd)}
                    {seg(r.inProduction, SEG.production)}
                  </div>
                  <div className="mt-1.5 truncate text-[11px] tabular text-muted">{parts.join(" · ")}</div>
                </div>
                {/* Coverage: on-hand months + production months */}
                <div>
                  <div className="tabular text-[15px] font-medium leading-none text-ink">{mo(r.onHandCover)}<span className="text-[10.5px] font-normal text-muted"> mo</span></div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">on hand</div>
                  {r.inProduction > 0 ? (
                    <div className="mt-1.5 tabular text-[13px] font-medium leading-none" style={{ color: SEG.production }}>+{mo(r.prodCover)}<span className="text-[10.5px] font-normal text-muted"> mo prod</span></div>
                  ) : (
                    <div className="mt-1.5 text-[11px] text-muted">no prod</div>
                  )}
                </div>
                {/* Status */}
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: st.bg, color: st.fg }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.dot }} /> {r.statusLabel}
                  </span>
                  {r.note && <div className="mt-1 text-[10px] text-muted">{r.note}</div>}
                </div>
                {/* Action + gear */}
                <div className="flex items-center justify-end gap-2">
                  <div className="text-right">
                    {r.belowFloor ? (
                      <>
                        <div className="text-[12.5px] font-medium tabular text-ink">{r.recommendedQty > 0 ? `${n(r.recommendedQty)} units` : "Order"}</div>
                        <div className="text-[10.5px] text-muted">recommended</div>
                      </>
                    ) : r.status === "oos" ? (
                      <>
                        <div className="text-[12.5px] font-medium" style={{ color: "#b91c1c" }}>Expedite</div>
                        <div className="text-[10.5px] text-muted">incoming lot</div>
                      </>
                    ) : (
                      <span className="text-[12px] text-muted">Covered</span>
                    )}
                  </div>
                  <button onClick={() => setEditSku(editSku === r.id ? null : r.id)} title="SKU settings" className="text-muted hover:text-ink-soft">
                    <Settings2 size={14} />
                  </button>
                </div>
              </div>
              {editSku === r.id && (
                <SkuPolicyEditor
                  row={r}
                  defaults={defaults}
                  pending={pending}
                  onSave={(f, l) => start(async () => { await updateSkuPolicy(r.id, f, l); setEditSku(null); router.refresh(); })}
                  bordered={i < computed.length - 1}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GlobalDefaultsEditor({ defaults, pending, onSave, onClose }: { defaults: { minMonths: number; leadMonths: number }; pending: boolean; onSave: (f: number, l: number) => void; onClose: () => void }) {
  const [f, setF] = useState(String(defaults.minMonths));
  const [l, setL] = useState(String(defaults.leadMonths));
  return (
    <div className="mb-2 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <NumField label="Default floor (months)" value={f} onChange={setF} />
      <NumField label="Default lead time (months)" value={l} onChange={setL} />
      <button onClick={() => onSave(parseFloat(f) || 5, parseFloat(l) || 4.5)} disabled={pending} className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60">
        <Check size={13} /> Save defaults
      </button>
      <button onClick={onClose} className="text-[12px] text-muted hover:text-ink-soft">Cancel</button>
    </div>
  );
}

function SkuPolicyEditor({ row, defaults, pending, onSave, bordered }: { row: RestockRow; defaults: { minMonths: number; leadMonths: number }; pending: boolean; onSave: (f: number | null, l: number | null) => void; bordered: boolean }) {
  const [f, setF] = useState(row.rawMinMonths != null ? String(row.rawMinMonths) : "");
  const [l, setL] = useState(row.rawLeadMonths != null ? String(row.rawLeadMonths) : "");
  return (
    <div className={`flex flex-wrap items-end gap-3 bg-surface-2 px-4 py-3 ${bordered ? "border-b border-line" : ""}`}>
      <NumField label={`Floor (months) · default ${defaults.minMonths}`} value={f} onChange={setF} placeholder={String(defaults.minMonths)} />
      <NumField label={`Lead time (months) · default ${defaults.leadMonths}`} value={l} onChange={setL} placeholder={String(defaults.leadMonths)} />
      <button onClick={() => onSave(f.trim() === "" ? null : parseFloat(f), l.trim() === "" ? null : parseFloat(l))} disabled={pending} className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60">
        <Check size={13} /> Save
      </button>
      <button onClick={() => onSave(null, null)} className="text-[12px] text-muted hover:text-ink-soft">Use defaults</button>
    </div>
  );
}

function NumField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="text-[11px] text-muted">
      <div className="mb-1">{label}</div>
      <input type="number" step="0.5" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8 w-32 rounded-lg border border-border bg-surface px-2 text-[13px] text-ink outline-none focus:border-accent-strong" />
    </label>
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
