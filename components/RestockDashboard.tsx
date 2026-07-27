"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Settings, Check, GripVertical } from "lucide-react";
import { HoverHint } from "@/components/HoverHint";
import { FLOOR_HELP, LEAD_HELP } from "@/lib/restock-help";
import { SkuAvatar } from "@/components/ui";
import { TotalValueCard } from "@/components/TotalValueCard";
import { updateGlobalDefaults, updateSkuPolicy, setSortMode, saveManualOrder, setSkuWindow } from "@/app/inventory/actions";
import type { RestockRow, RestockTotals } from "@/lib/restock";
import { computeReorder, type ReorderResult } from "@/lib/reorder";
import { SEG } from "@/lib/segments";

type SortMode = "sales" | "available" | "manual";
const SORT_LABEL: Record<SortMode, string> = { sales: "Monthly sales", available: "Units available", manual: "Manual" };

const WINDOWS = [10, 30, 90] as const;
type Win = (typeof WINDOWS)[number];


type Status = "ok" | "reordered" | "reorder" | "oos" | "ship";
const STATUS: Record<Status, { bg: string; fg: string; dot: string; label: string }> = {
  ok: { bg: "#dcfce7", fg: "#166534", dot: "#16a34a", label: "Healthy" },
  reordered: { bg: "#dcfce7", fg: "#166534", dot: "#16a34a", label: "Reordered" },
  reorder: { bg: "#ffedd5", fg: "#9a3412", dot: "#ea580c", label: "Reorder" },
  oos: { bg: "#fee2e2", fg: "#b91c1c", dot: "#dc2626", label: "OOS" },
  ship: { bg: "#ede9fe", fg: "#5b21b6", dot: "#8b5cf6", label: "Ship stock" },
};

/** What each status actually means, in the terms the person reading it thinks in. Kept next to
 *  the colours so the two can't drift apart. */
const STATUS_HELP: Record<Status, { title: string; body: string }> = {
  ok: {
    title: "Healthy",
    body:
      "The sales channel holds at least your floor — enough cover to get through a production run without running dry. Nothing to do.",
  },
  reordered: {
    title: "Reordered",
    body:
      "Channel stock is below your floor, but a production lot is already on its way and it lands in time. Covered — no new order needed.",
  },
  reorder: {
    title: "Reorder",
    body:
      "Cover is below your floor and nothing incoming closes the gap. Place a purchase order now — waiting eats into the lead time.",
  },
  oos: {
    title: "Out of stock",
    body:
      "A lot is coming, but at the current sales rate the channel runs out before it arrives. The number of days is how long you'll be unable to sell. Expediting the lot is the only thing that closes the gap — if you were holding units of your own, this would say Ship stock instead.",
  },
  ship: {
    title: "Ship stock",
    body:
      "You already have finished units at your own locations while the channel is below its floor. Send those first — producing more would leave stock sitting in two places. There's no real shortage here: the stock exists, it just needs moving. A warning only appears if the channel would run dry before a shipment could land, or if shipping everything still wouldn't be enough.",
  },
};

const n = (x: number) => Math.round(x).toLocaleString("en-US");
const mo = (x: number) => (x === Infinity ? "∞" : x.toFixed(1));

type Computed = RestockRow & ReorderResult;

function compute(r: RestockRow, globalWin: Win, nowMs: number): Computed {
  return { ...r, ...computeReorder(r, globalWin, nowMs) };
}

export function RestockDashboard({
  rows,
  totals,
  defaults,
  sortMode: initialSort,
  nowMs,
}: {
  rows: RestockRow[];
  totals: RestockTotals;
  defaults: { minMonths: number; leadMonths: number };
  sortMode: string;
  nowMs: number;
}) {
  const [win, setWin] = useState<Win>(90);
  const [pending, start] = useTransition();
  const [editSku, setEditSku] = useState<string | null>(null);
  const [winSku, setWinSku] = useState<string | null>(null); // per-SKU window-override panel open
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
  const needsPO = computed.filter((r) => r.belowFloor).length;
  const toShip = computed.filter((r) => r.status === "ship").length;
  const expedite = computed.filter((r) => r.status === "oos" && !r.belowFloor).length;
  const healthy = computed.filter((r) => r.status === "ok" || r.status === "reordered").length;
  const unitsToOrder = computed.reduce((s, r) => s + (r.belowFloor ? r.recommendedQty : 0), 0);

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

  return (
    <div>
      {/* Full width — syncing moved up beside the tabs so this card isn't squeezed. */}
      <div className="mb-3">
        <TotalValueCard totals={totals} />
      </div>

      {/* KPIs */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Needs a PO" value={String(needsPO)} tone={needsPO > 0 ? "#ea580c" : undefined} />
        <Kpi label="To ship" value={String(toShip)} tone={toShip > 0 ? SEG.locations : undefined} />
        <Kpi label="Expedite" value={String(expedite)} tone={expedite > 0 ? "#dc2626" : undefined} />
        <Kpi label="Healthy" value={`${healthy} / ${computed.length}`} tone={computed.length > 0 && healthy === computed.length ? "#16a34a" : undefined} />
        <Kpi label="Units to order" value={n(unitsToOrder)} />
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
            <span className="text-[11px] text-muted">Sort</span>
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
          {/* Reads as a control, not a caption: a gear, a filled chip, and a hover state, so it's
              findable as the place to change the restock defaults. */}
          <button
            onClick={() => setEditGlobal((v) => !v)}
            title="Change the default floor and lead time"
            aria-expanded={editGlobal}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors ${
              editGlobal
                ? "border-accent-strong bg-accent-soft text-accent"
                : "border-border bg-surface-2 text-ink-soft hover:border-accent-strong hover:bg-accent-soft/40 hover:text-accent"
            }`}
          >
            <Settings size={13} />
            Floor {defaults.minMonths}mo · Lead {defaults.leadMonths}mo
          </button>
        </div>
        <div className="flex flex-wrap gap-2.5 text-[11px] text-muted">
          <Legend color={SEG.available} label="Available" />
          <Legend color={SEG.inbound} label="Inbound" />
          <Legend color={SEG.reserved} label="Reserved" />
          <Legend color={SEG.awd} label="AWD" />
          <Legend color={SEG.locations} label="At my locations" />
          <Legend color={SEG.production} label="Production" />
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
          const totalUnits = r.onHand + r.atLocations + r.inProduction;
          const seg = (v: number, c: string) => (v > 0 ? <div key={c} style={{ width: `${(v / (totalUnits || 1)) * 100}%`, background: c }} /> : null);
          const parts = [
            r.fbaAvailable && `${n(r.fbaAvailable)} Available`,
            r.fbaInbound && `${n(r.fbaInbound)} Inbound`,
            r.fbaReserved && `${n(r.fbaReserved)} Reserved`,
            r.awdTotal && `${n(r.awdTotal)} AWD`,
            r.atLocations && `${n(r.atLocations)} At ${r.atLocationsBy.map((x) => x.code).join("/")}`,
            r.inProduction && `${n(r.inProduction)} In production`,
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
              <div className={`grid grid-cols-[minmax(180px,1.4fr)_84px_minmax(0,1.7fr)_112px_128px_112px] items-center gap-4 px-4 py-3 ${i < displayRows.length - 1 && editSku !== r.id && winSku !== r.id ? "border-b border-line" : ""}`}>
                {/* SKU */}
                <div className="flex min-w-0 items-center gap-2.5">
                  {arranging && <GripVertical size={16} className="shrink-0 text-muted" />}
                  <SkuAvatar code={r.code} imageUrl={r.imageUrl} size={32} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-ink">{r.name}</div>
                    {/* Highlight the settings that are actually overriding the defaults, not just
                        the label below. The window is only its own override when the SKU pins one —
                        otherwise it's just the global toggle and colouring it would imply a custom
                        setting that isn't there. */}
                    <div className="text-[11px] tabular text-muted">
                      {n(r.monthly)}/mo
                      {" · "}
                      <span className={r.windowDays != null ? "font-medium text-accent" : ""}>{r.win}-day</span>
                      {r.excl > 0 && (
                        <>
                          {" · "}
                          <span className="font-medium text-accent">−{r.excl}d OOS</span>
                        </>
                      )}
                    </div>
                    <button onClick={() => setWinSku(winSku === r.id ? null : r.id)} className={`mt-0.5 text-[10px] hover:underline ${r.override ? "text-accent" : "text-muted"}`}>
                      {r.override ? "Custom window" : "Override window"}
                    </button>
                  </div>
                </div>
                {/* Total units */}
                <div>
                  <div className="text-[15px] font-medium leading-none tabular text-ink">{n(totalUnits)}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">Units</div>
                </div>
                {/* Pipeline bar */}
                <div className="min-w-0">
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
                    {seg(r.fbaAvailable, SEG.available)}
                    {seg(r.fbaInbound, SEG.inbound)}
                    {seg(r.fbaReserved, SEG.reserved)}
                    {seg(r.awdTotal, SEG.awd)}
                    {seg(r.atLocations, SEG.locations)}
                    {seg(r.inProduction, SEG.production)}
                  </div>
                  {/* Wraps rather than truncates — spelling the buckets out in full is pointless
                      if the line gets cut off halfway through "Reserved". */}
                  <div className="mt-1.5 text-[11px] tabular text-muted">{parts.join(" · ")}</div>
                </div>
                {/* Coverage: months on hand, then what's waiting at your locations and in production */}
                <div>
                  <div className="tabular text-[15px] font-medium leading-none text-ink">{mo(r.onHandCover)}<span className="text-[10.5px] font-normal text-muted"> mo</span></div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">On hand</div>
                  {r.atLocations > 0 && (
                    <div className="mt-1.5 tabular text-[13px] font-medium leading-none" style={{ color: SEG.locations }}>
                      +{mo(r.locCover)}<span className="text-[10.5px] font-normal text-muted"> mo at my locations</span>
                    </div>
                  )}
                  {r.inProduction > 0 ? (
                    <div className="mt-1.5 tabular text-[13px] font-medium leading-none" style={{ color: SEG.production }}>+{mo(r.prodCover)}<span className="text-[10.5px] font-normal text-muted"> mo in production</span></div>
                  ) : (
                    r.atLocations === 0 && <div className="mt-1.5 text-[11px] text-muted">No production</div>
                  )}
                </div>
                {/* Status */}
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: st.bg, color: st.fg }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.dot }} />
                    {r.statusLabel}
                    <HoverHint {...STATUS_HELP[r.status]} size={11} />
                  </span>
                  {r.note && <div className="mt-1 text-[10px] text-muted">{r.note}</div>}
                </div>
                {/* Action + gear */}
                <div className="flex items-center justify-end gap-2">
                  <div className="text-right">
                    {r.status === "ship" ? (
                      <>
                        <div className="text-[12.5px] font-medium tabular" style={{ color: SEG.locations }}>
                          Ship {n(r.shipQty)} units
                        </div>
                        <div className="text-[10.5px] text-muted">
                          From {r.atLocationsBy.map((x) => x.code).join(" / ") || "your locations"}
                          {r.recommendedQty > 0 && ` · Then order ${n(r.recommendedQty)}`}
                        </div>
                      </>
                    ) : r.belowFloor ? (
                      <>
                        <div className="text-[12.5px] font-medium tabular text-ink">{r.recommendedQty > 0 ? `${n(r.recommendedQty)} units` : "Order"}</div>
                        <div className="text-[10.5px] text-muted">Recommended</div>
                      </>
                    ) : r.status === "oos" ? (
                      <>
                        <div className="text-[12.5px] font-medium" style={{ color: "#b91c1c" }}>Expedite</div>
                        <div className="text-[10.5px] text-muted">Incoming lot</div>
                      </>
                    ) : (
                      <span className="text-[12px] text-muted">Covered</span>
                    )}
                  </div>
                  <button
                    onClick={() => setEditSku(editSku === r.id ? null : r.id)}
                    title="Floor and lead time for this product"
                    aria-expanded={editSku === r.id}
                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                      editSku === r.id
                        ? "border-accent-strong bg-accent-soft text-accent"
                        : "border-border bg-surface-2 text-muted hover:border-accent-strong hover:bg-accent-soft/40 hover:text-accent"
                    }`}
                  >
                    <Settings size={13} />
                  </button>
                </div>
              </div>
              {winSku === r.id && (
                <WindowOverrideEditor
                  row={r}
                  globalWin={win}
                  pending={pending}
                  onSave={(wd, ex) => start(async () => { await setSkuWindow(r.id, wd, ex); setWinSku(null); router.refresh(); })}
                  onClear={() => start(async () => { await setSkuWindow(r.id, null, null); setWinSku(null); router.refresh(); })}
                  bordered={i < displayRows.length - 1}
                />
              )}
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
      <NumField label="Default floor (months)" value={f} onChange={setF} help={FLOOR_HELP} />
      <NumField label="Default lead time (months)" value={l} onChange={setL} help={LEAD_HELP} />
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
      <NumField label={`Floor (months) · default ${defaults.minMonths}`} value={f} onChange={setF} placeholder={String(defaults.minMonths)} help={FLOOR_HELP} />
      <NumField label={`Lead time (months) · default ${defaults.leadMonths}`} value={l} onChange={setL} placeholder={String(defaults.leadMonths)} help={LEAD_HELP} />
      <button onClick={() => onSave(f.trim() === "" ? null : parseFloat(f), l.trim() === "" ? null : parseFloat(l))} disabled={pending} className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60">
        <Check size={13} /> Save
      </button>
      <button onClick={() => onSave(null, null)} className="text-[12px] text-muted hover:text-ink-soft">Use defaults</button>
    </div>
  );
}

function WindowOverrideEditor({
  row,
  globalWin,
  pending,
  onSave,
  onClear,
  bordered,
}: {
  row: RestockRow;
  globalWin: Win;
  pending: boolean;
  onSave: (windowDays: number, excludeDays: number | null) => void;
  onClear: () => void;
  bordered: boolean;
}) {
  const initWin: Win = row.windowDays === 10 || row.windowDays === 30 || row.windowDays === 90 ? row.windowDays : globalWin;
  const [w, setW] = useState<Win>(initWin);
  const [ex, setEx] = useState(row.excludeDays != null ? String(row.excludeDays) : "");
  const hasOverride = row.windowDays != null || (row.excludeDays ?? 0) > 0;
  const exNum = ex.trim() === "" ? 0 : Math.max(0, Math.floor(Number(ex)) || 0);
  return (
    <div className={`flex flex-wrap items-end gap-4 bg-surface-2 px-4 py-3 ${bordered ? "border-b border-line" : ""}`}>
      <div>
        <div className="mb-1 text-[11px] text-muted">Window for this SKU</div>
        <div className="flex gap-0.5 rounded-lg border border-border bg-surface p-0.5">
          {WINDOWS.map((x) => (
            <button key={x} onClick={() => setW(x)} className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${w === x ? "bg-accent-soft text-accent" : "text-muted hover:text-ink-soft"}`}>
              {x}d
            </button>
          ))}
        </div>
      </div>
      <label className="text-[11px] text-muted">
        <div className="mb-1">Exclude last OOS days</div>
        <input type="number" min={0} step={1} value={ex} onChange={(e) => setEx(e.target.value)} placeholder="0" className="h-8 w-28 rounded-lg border border-border bg-surface px-2 text-[13px] text-ink outline-none focus:border-accent-strong" />
      </label>
      <div className="pb-0.5 text-[11px] text-muted">
        averages {Math.max(1, w - Math.min(exNum, w - 1))} day{w - Math.min(exNum, w - 1) === 1 ? "" : "s"}
      </div>
      <button onClick={() => onSave(w, exNum > 0 ? exNum : null)} disabled={pending} className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60">
        <Check size={13} /> Save override
      </button>
      {hasOverride && (
        <button onClick={onClear} disabled={pending} className="text-[12px] font-medium text-[#dc2626] hover:underline disabled:opacity-60">
          Clear
        </button>
      )}
    </div>
  );
}

function NumField({ label, value, onChange, placeholder, help }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; help?: { title: string; body: string } }) {
  return (
    <label className="text-[11px] text-muted">
      <div className="mb-1 flex items-center gap-1">
        {help && <HoverHint {...help} size={11} />}
        {label}
      </div>
      <input type="number" step="0.5" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8 w-32 rounded-lg border border-border bg-surface px-2 text-[13px] text-ink outline-none focus:border-accent-strong" />
    </label>
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
