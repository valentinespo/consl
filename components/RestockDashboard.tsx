"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Settings, Check, GripVertical } from "lucide-react";
import { HoverHint } from "@/components/HoverHint";
import { BATCH_HELP, BUFFER_HELP, FLOOR_HELP, LEAD_HELP, REORDER_TO_HELP, SHIP_HELP } from "@/lib/restock-help";
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


/** The org-wide restock settings every SKU falls back to. */
export type Defaults = {
  minMonths: number;
  leadMonths: number;
  shipDays: number;
  shipBufferX: number;
  reorderTo: number;
  batchSize: number;
};

/** Where the SKU stands. Five situations and no instructions — what to do about it lives in the
 *  Action column, because a row can need shipping, expediting and a PO at once. A green pill
 *  guarantees the action column is empty. */
type Status = "ok" | "reordered" | "channelLow" | "belowFloor" | "oos";
const STATUS: Record<Status, { bg: string; fg: string; dot: string }> = {
  ok: { bg: "#dcfce7", fg: "#166534", dot: "#16a34a" },
  reordered: { bg: "#dcfce7", fg: "#166534", dot: "#16a34a" },
  channelLow: { bg: "#ede9fe", fg: "#5b21b6", dot: "#8b5cf6" },
  belowFloor: { bg: "#ffedd5", fg: "#9a3412", dot: "#ea580c" },
  oos: { bg: "#fee2e2", fg: "#b91c1c", dot: "#dc2626" },
};

/** What each status means, in the terms the person reading it thinks in. Kept next to the colours
 *  so the two can't drift apart, and kept short — it's a tooltip, not a manual. */
const STATUS_HELP: Record<Status, { title: string; body: string }> = {
  ok: {
    title: "Healthy",
    body: "You hold at least your floor, and the channel won't run dry before more stock can reach it.",
  },
  reordered: {
    title: "Reordered",
    body: "Below your floor, but a lot is already coming and it lands in time. Nothing to do.",
  },
  channelLow: {
    title: "Running low",
    body: "The sales channel is running low — a shipment needs to leave within the days shown in the Action column. You already own the stock to send.",
  },
  belowFloor: {
    title: "Below floor",
    body: "You own less cover than your floor, counting everything including production. Place an order.",
  },
  oos: {
    title: "Out of stock",
    body: "The channel hits zero — this is how many days you can't sell, counting stock you'd ship today and any lot on the way. The Action column lists everything that shrinks it.",
  },
};

/** One column template, used by the header and every row — they must not drift apart. */
const GRID = "grid-cols-[minmax(180px,1.4fr)_84px_minmax(0,1.7fr)_112px_128px_112px]";

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
  defaults: Defaults;
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
  const needsPO = computed.filter((r) => r.order).length;
  // Counted off the actions rather than the status, so a stockout that also needs shipping shows
  // up in both tiles instead of only the more severe one.
  const toShip = computed.filter((r) => r.ship).length;
  const expedite = computed.filter((r) => r.expedite).length;
  const healthy = computed.filter((r) => r.status === "ok" || r.status === "reordered").length;
  const unitsToOrder = computed.reduce((s, r) => s + r.recommendedQty, 0);

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
            Floor {defaults.minMonths}mo · Lead {defaults.leadMonths}mo · Ship {defaults.shipDays}d
          </button>
        </div>
        <div className="flex flex-wrap gap-2.5 text-[11px] text-muted">
          <Legend color={SEG.awd} label="AWD" />
          <Legend color={SEG.available} label="Available" />
          <Legend color={SEG.inbound} label="Inbound" />
          <Legend color={SEG.reserved} label="Reserved" />
          <Legend color={SEG.locations} label="At my locations" />
          <Legend color={SEG.production} label="Production" />
        </div>
      </div>

      {editGlobal && (
        <GlobalDefaultsEditor
          defaults={defaults}
          pending={pending}
          onSave={(d) => start(async () => { await updateGlobalDefaults(d); setEditGlobal(false); router.refresh(); })}
          onClose={() => setEditGlobal(false)}
        />
      )}

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        {/* Column headings. Same grid template as every row, so they stay lined up. */}
        {displayRows.length > 0 && (
          <div
            className={`grid ${GRID} items-end gap-4 border-b border-border bg-surface-2/60 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted`}
          >
            <div>Product</div>
            <div>Units</div>
            <div>Where the stock is</div>
            <div>Cover</div>
            <div>Status</div>
            <div className="text-right">Action</div>
          </div>
        )}
        {displayRows.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-muted">No Amazon-mapped SKUs yet — hit Sync.</div>}
        {displayRows.map((r, i) => {
          const st = STATUS[r.status];
          // This SKU pins at least one of its own restock settings, so it ignores a default. Keep
          // the gear blue even when closed, as a badge that this row is overriding something.
          const hasPolicyOverride =
            r.rawMinMonths != null ||
            r.rawLeadMonths != null ||
            r.rawShipDays != null ||
            r.rawReorderToMonths != null ||
            r.rawBatchSize != null;
          const totalUnits = r.onHand + r.atLocations + r.inProduction;
          const seg = (v: number, c: string) => (v > 0 ? <div key={c} style={{ width: `${(v / (totalUnits || 1)) * 100}%`, background: c }} /> : null);
          const parts = [
            // Same order as the bar above it, or the two read as contradicting each other.
            r.awdTotal && `${n(r.awdTotal)} AWD`,
            r.fbaAvailable && `${n(r.fbaAvailable)} Available`,
            r.fbaInbound && `${n(r.fbaInbound)} Inbound`,
            r.fbaReserved && `${n(r.fbaReserved)} Reserved`,
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
              <div className={`grid ${GRID} items-center gap-4 px-4 py-3 ${i < displayRows.length - 1 && editSku !== r.id && winSku !== r.id ? "border-b border-line" : ""}`}>
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
                    {/* Greens run darkest → lightest, so the channel's stock reads as one ramp. */}
                    {seg(r.awdTotal, SEG.awd)}
                    {seg(r.fbaAvailable, SEG.available)}
                    {seg(r.fbaInbound, SEG.inbound)}
                    {seg(r.fbaReserved, SEG.reserved)}
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
                    {(() => {
                      // A row can need several things at once — ship what you have, pull the lot
                      // forward, and still start a run. Showing only the first one was how the
                      // ship instruction used to vanish the moment a row turned red.
                      const acts: { label: string; sub: string; color?: string }[] = [];
                      if (r.ship)
                        acts.push({
                          label: "Ship units",
                          sub:
                            `From ${r.atLocationsBy.map((x) => x.code).join(" / ") || "your locations"}` +
                            (r.shipWithinDays > 0 ? ` · within ${r.shipWithinDays}d` : ""),
                          color: SEG.locations,
                        });
                      if (r.expedite) acts.push({ label: "Expedite", sub: "Incoming lot", color: "#b91c1c" });
                      if (r.recommendedQty > 0)
                        acts.push({ label: `Order ${n(r.recommendedQty)} units`, sub: "Recommended" });
                      if (acts.length === 0) return <span className="text-[12px] text-muted">Covered</span>;
                      return acts.map((a, k) => (
                        <div key={a.label} className={k > 0 ? "mt-1.5" : ""}>
                          <div className="text-[12.5px] font-medium tabular" style={a.color ? { color: a.color } : undefined}>
                            {a.label}
                          </div>
                          <div className="text-[10.5px] text-muted">{a.sub}</div>
                        </div>
                      ));
                    })()}
                  </div>
                  <button
                    onClick={() => setEditSku(editSku === r.id ? null : r.id)}
                    title={hasPolicyOverride ? "Custom restock policy for this product" : "Restock policy for this product"}
                    aria-expanded={editSku === r.id}
                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                      editSku === r.id || hasPolicyOverride
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
                  onSave={(pol) => start(async () => { await updateSkuPolicy(r.id, pol); setEditSku(null); router.refresh(); })}
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



/** Org-wide restock settings. Shipping time is here only — it's a property of how you move stock,
 *  not of any one product, so there's deliberately no per-SKU override for it. */
function GlobalDefaultsEditor({
  defaults,
  pending,
  onSave,
  onClose,
}: {
  defaults: Defaults;
  pending: boolean;
  onSave: (d: Defaults) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState(String(defaults.minMonths));
  const [l, setL] = useState(String(defaults.leadMonths));
  const [sh, setSh] = useState(String(defaults.shipDays));
  const [bx, setBx] = useState(String(defaults.shipBufferX));
  const [rt, setRt] = useState(String(defaults.reorderTo));
  const [bs, setBs] = useState(String(defaults.batchSize));
  const num = (v: string, fallback: number) => (v.trim() === "" ? fallback : parseFloat(v) || fallback);
  return (
    <div className="mb-2 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <NumField label="Default floor (months)" value={f} onChange={setF} help={FLOOR_HELP} />
      <NumField label="Production lead time (months)" value={l} onChange={setL} help={LEAD_HELP} />
      <NumField label="Shipping time (days)" value={sh} onChange={setSh} help={SHIP_HELP} />
      <NumField label="Shipping buffer (×)" value={bx} onChange={setBx} help={BUFFER_HELP} />
      <NumField label="Order size (months)" value={rt} onChange={setRt} help={REORDER_TO_HELP} />
      <NumField label="Default batch size (units)" value={bs} onChange={setBs} help={BATCH_HELP} />
      <button
        onClick={() =>
          onSave({
            minMonths: num(f, 5),
            leadMonths: num(l, 4.5),
            shipDays: num(sh, 30),
            shipBufferX: num(bx, 3),
            reorderTo: num(rt, 8),
            batchSize: num(bs, 0),
          })
        }
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
      >
        <Check size={13} /> Save defaults
      </button>
      <button onClick={onClose} className="text-[12px] text-muted hover:text-ink-soft">Cancel</button>
    </div>
  );
}

export type SkuPolicy = {
  minMonths: number | null;
  leadMonths: number | null;
  shipDays: number | null;
  reorderToMonths: number | null;
  batchSize: number | null;
};

/** Per-SKU overrides. Blank means "use the default", which is why every box shows the default it
 *  would fall back to — including reorder-to and batch size, which until now could be seen on the
 *  catalog page but changed nowhere at all. */
function SkuPolicyEditor({
  row,
  defaults,
  pending,
  onSave,
  bordered,
}: {
  row: RestockRow;
  defaults: Defaults;
  pending: boolean;
  onSave: (p: SkuPolicy) => void;
  bordered: boolean;
}) {
  const [f, setF] = useState(row.rawMinMonths != null ? String(row.rawMinMonths) : "");
  const [l, setL] = useState(row.rawLeadMonths != null ? String(row.rawLeadMonths) : "");
  const [sh, setSh] = useState(row.rawShipDays != null ? String(row.rawShipDays) : "");
  const [rt, setRt] = useState(row.rawReorderToMonths != null ? String(row.rawReorderToMonths) : "");
  const [b, setB] = useState(row.rawBatchSize != null ? String(row.rawBatchSize) : "");
  const opt = (v: string) => (v.trim() === "" ? null : parseFloat(v));
  return (
    <div className={`flex flex-wrap items-end gap-3 bg-surface-2 px-4 py-3 ${bordered ? "border-b border-line" : ""}`}>
      <NumField label="Floor (months)" value={f} onChange={setF} placeholder={String(defaults.minMonths)} help={FLOOR_HELP} />
      <NumField label="Production lead time (months)" value={l} onChange={setL} placeholder={String(defaults.leadMonths)} help={LEAD_HELP} />
      <NumField label="Shipping time (days)" value={sh} onChange={setSh} placeholder={String(defaults.shipDays)} help={SHIP_HELP} />
      <NumField label="Order size (months)" value={rt} onChange={setRt} placeholder={String(defaults.reorderTo)} help={REORDER_TO_HELP} />
      <NumField
        label="Batch size (units)"
        value={b}
        onChange={setB}
        placeholder={defaults.batchSize > 0 ? String(defaults.batchSize) : "No rounding"}
        help={BATCH_HELP}
      />
      <button
        onClick={() =>
          onSave({ minMonths: opt(f), leadMonths: opt(l), shipDays: opt(sh), reorderToMonths: opt(rt), batchSize: opt(b) })
        }
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
      >
        <Check size={13} /> Save
      </button>
      <button
        onClick={() => onSave({ minMonths: null, leadMonths: null, shipDays: null, reorderToMonths: null, batchSize: null })}
        className="text-[12px] text-muted hover:text-ink-soft"
      >
        Use defaults
      </button>
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
