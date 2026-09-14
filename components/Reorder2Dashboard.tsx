"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Settings, Check, ChevronDown, GripVertical, MapTrifold } from "@/components/icons";
import { HoverHint } from "@/components/HoverHint";
import { SkuAvatar } from "@/components/ui";
import { updateGlobalDefaults, updateSkuPolicy, setSortMode, saveManualOrder, setSkuWindow } from "@/app/inventory/actions";
import { computeReorder2, type Place, type PlaceResult, type PlaceStock, type Reorder2Result, type Reorder2Row, type StockRoute } from "@/lib/reorder2-engine";
import type { Win } from "@/lib/reorder";
import { SEG } from "@/lib/segments";
import { useMoney } from "@/components/CurrencyProvider";
import { STATUS, STATUS_HELP, GlobalDefaultsEditor, SkuPolicyEditor, WindowOverrideEditor, Kpi, Legend, type Defaults } from "@/components/RestockDashboard";
import { StockRoutesEditor } from "@/components/StockRoutesEditor";

type SortMode = "sales" | "available" | "manual";
const WINDOWS = [10, 30, 90] as const;

/** One column template, used by the header and every row — they must not drift apart. */
const GRID = "grid-cols-[minmax(180px,1.4fr)_84px_minmax(0,1.7fr)_112px_128px_minmax(150px,1fr)]";
const PLACE_GRID = "grid-cols-[minmax(180px,1.4fr)_84px_minmax(0,1.7fr)_112px_128px_minmax(150px,1fr)]";

const mo = (x: number) => (x === Infinity ? "∞" : x.toFixed(1));

const KIND_LABEL: Record<Place["kind"], string> = { own: "Your facility", AMAZON_FBA: "Amazon FBA", AMAZON_AWD: "Amazon AWD", SHOPIFY: "Shopify", TIKTOK: "TikTok", none: "orders with no place yet" };
const KIND_COLOR: Record<Place["kind"], string> = { own: SEG.locations, AMAZON_FBA: SEG.available, AMAZON_AWD: SEG.awd, SHOPIFY: SEG.shopify, TIKTOK: SEG.tiktok, none: "var(--color-muted)" };

/** A row with its stock cells kept apart from the engine's per-place results (both were called `places`). */
type Computed = Omit<Reorder2Row, "places"> & Reorder2Result & { cells: PlaceStock[] };

export function Reorder2Dashboard({
  rows,
  places,
  routes,
  routesSaved,
  defaults,
  sortMode: initialSort,
  nowMs,
}: {
  rows: Reorder2Row[];
  places: Place[];
  routes: StockRoute[];
  routesSaved: boolean;
  defaults: Defaults;
  sortMode: string;
  nowMs: number;
}) {
  const { qty: n } = useMoney();
  const [win, setWin] = useState<Win>(30);
  const [pending, start] = useTransition();
  const params = useSearchParams();
  const policyFor = params.get("policy");
  // Arriving from a product page ("Edit on Reorder"): open that product's policy editor.
  const [editSku, setEditSku] = useState<string | null>(policyFor && rows.some((r) => r.id === policyFor) ? policyFor : null);
  const [winSku, setWinSku] = useState<string | null>(null);
  const [editGlobal, setEditGlobal] = useState(false);
  const [editRoutes, setEditRoutes] = useState(false);
  const [sort, setSort] = useState<SortMode>((["sales", "available", "manual"].includes(initialSort) ? initialSort : "sales") as SortMode);
  const [arranging, setArranging] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const dragId = useRef<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!policyFor || !rows.some((r) => r.id === policyFor)) return;
    window.history.replaceState(null, "", window.location.pathname);
    requestAnimationFrame(() => {
      document.getElementById(`reorder2-${policyFor}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [policyFor, rows]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, { ...r, ...computeReorder2(r, places, routes, win, nowMs), cells: r.places } as Computed])), [rows, places, routes, win, nowMs]);
  const computed = useMemo(() => {
    const arr = [...byId.values()];
    if (sort === "available") arr.sort((a, b) => b.totalUnits - a.totalUnits);
    else if (sort === "manual") arr.sort((a, b) => (a.sortIndex ?? 9999) - (b.sortIndex ?? 9999) || b.monthly - a.monthly);
    else arr.sort((a, b) => b.monthly - a.monthly);
    return arr;
  }, [byId, sort]);
  const displayRows = arranging ? order.map((id) => byId.get(id)).filter((r): r is Computed => !!r) : computed;
  const needsPO = computed.filter((r) => r.order).length;
  const toMove = computed.filter((r) => r.ship).length;
  const expedite = computed.filter((r) => r.expedite).length;
  // Products that don't sell yet (still in production, not launched) are neither healthy nor
  // unhealthy — they sit outside the count.
  const sellingProducts = computed.filter((r) => r.status !== "nosales").length;
  const healthy = computed.filter((r) => r.status === "ok" || r.status === "reordered").length;
  const unitsToOrder = computed.reduce((s, r) => s + r.recommendedQty, 0);
  const actionTone = (flag: "order" | "ship") => (computed.some((r) => r[flag] && r.status === "oos") ? "var(--color-negative)" : "var(--color-warn)");
  const realPlaces = places.filter((p) => p.kind !== "none");

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
      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Needs a PO" value={String(needsPO)} tone={needsPO > 0 ? actionTone("order") : undefined} />
        <Kpi label="To move" value={String(toMove)} tone={toMove > 0 ? actionTone("ship") : undefined} />
        <Kpi label="Expedite" value={String(expedite)} tone={expedite > 0 ? "var(--color-negative)" : undefined} />
        <Kpi label="Healthy" value={`${healthy} / ${sellingProducts}`} tone={sellingProducts > 0 && healthy === sellingProducts ? "#16a34a" : undefined} />
        <Kpi label="Units to order" value={n(unitsToOrder)} />
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] font-medium text-ink">Window</span>
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
              <button onClick={confirmOrder} disabled={pending} className="inline-flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1.5 text-[12px] font-medium text-bg disabled:opacity-60">
                <Check size={13} /> Done
              </button>
            )}
          </div>
          <button
            onClick={() => { setEditGlobal((v) => !v); setEditRoutes(false); }}
            title="Change the default floor and lead time"
            aria-expanded={editGlobal}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors ${
              editGlobal ? "border-accent-strong bg-accent-soft text-accent" : "border-border bg-surface-2 text-ink-soft hover:border-accent-strong hover:bg-accent-soft/40 hover:text-accent"
            }`}
          >
            <Settings size={13} />
            Floor {defaults.minMonths}mo · Lead {defaults.leadMonths}mo · Ship {defaults.shipDays}d
          </button>
          <button
            onClick={() => { setEditRoutes((v) => !v); setEditGlobal(false); }}
            title="Which facilities can send stock to which"
            aria-expanded={editRoutes}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors ${
              editRoutes ? "border-accent-strong bg-accent-soft text-accent" : "border-border bg-surface-2 text-ink-soft hover:border-accent-strong hover:bg-accent-soft/40 hover:text-accent"
            }`}
          >
            <MapTrifold size={13} />
            Stock routes · {routes.length}
            {!routesSaved && <span className="pill-amber inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium">suggested</span>}
          </button>
        </div>
        <div className="flex flex-wrap gap-2.5 text-[11px] text-muted">
          <Legend color={SEG.awd} label="AWD" />
          <Legend color={SEG.available} label="FBA" />
          <Legend color={SEG.inbound} label="Inbound" />
          <Legend color={SEG.locations} label="Your facilities" />
          <Legend color={SEG.shopify} label="Shopify" />
          <Legend color={SEG.tiktok} label="TikTok" />
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
      {editRoutes && <StockRoutesEditor places={places} routes={routes} saved={routesSaved} shipDays={defaults.shipDays} onClose={() => setEditRoutes(false)} />}

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
       <div className="min-w-[1040px]">
        {displayRows.length > 0 && (
          <div className={`grid ${GRID} items-end gap-4 border-b border-border bg-surface-2/60 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted`}>
            <div>Product · place</div>
            <div>Units</div>
            <div>Where the stock is</div>
            <div>Cover</div>
            <div>Status</div>
            <div className="text-right">Action</div>
          </div>
        )}
        {displayRows.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-muted">No products yet.</div>}
        {displayRows.map((r, i) => {
          const st = STATUS[r.status];
          const hasPolicyOverride = r.rawMinMonths != null || r.rawLeadMonths != null || r.rawShipDays != null || r.rawReorderToMonths != null || r.rawBatchSize != null;
          const production = r.inProductionBy.reduce((t, p) => t + p.units, 0);
          const segs = r.cells
            .filter((c) => c.placeId !== "none")
            .map((c) => ({ place: places.find((p) => p.id === c.placeId)!, units: c.sellable + c.inbound }))
            .filter((x) => x.place && x.units > 0)
            .sort((a, b) => KIND_ORDER[a.place.kind] - KIND_ORDER[b.place.kind] || b.units - a.units);
          const total = r.totalUnits || 1;
          const parts = [...segs.map((x) => `${n(x.units)} ${x.place.code}`), ...(production > 0 ? [`${n(production)} In production`] : [])];
          const last = i === displayRows.length - 1;
          return (
            <div
              key={r.id}
              id={`reorder2-${r.id}`}
              draggable={arranging}
              onDragStart={() => { dragId.current = r.id; }}
              onDragOver={(e) => { if (arranging) { e.preventDefault(); onDragOver(r.id); } }}
              onDragEnd={() => { dragId.current = null; }}
              className={`${arranging ? "cursor-grab active:cursor-grabbing" : ""} ${!last ? "border-b border-border" : ""}`}
            >
              <div className={`grid ${GRID} items-center gap-4 px-4 py-3`}>
                <div className="flex min-w-0 items-center gap-2.5">
                  {arranging && <GripVertical size={16} className="shrink-0 text-muted" />}
                  <SkuAvatar code={r.code} imageUrl={r.imageUrl} size={32} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-ink">{r.name}</div>
                    <div className="text-[11px] tabular text-muted">
                      {n(r.monthly)}/mo{" · "}
                      <span className={r.windowDays != null ? "font-medium text-accent" : ""}>{r.win}-day</span>
                      {(r.excludeDays ?? 0) > 0 && (<>{" · "}<span className="font-medium text-accent">−{r.excludeDays}d OOS</span></>)}
                    </div>
                    <button
                      onClick={() => setWinSku(winSku === r.id ? null : r.id)}
                      aria-expanded={winSku === r.id}
                      className={`mt-0.5 inline-flex items-center gap-1 text-[10px] hover:underline ${r.windowDays != null || (r.excludeDays ?? 0) > 0 ? "text-accent" : "text-muted"}`}
                    >
                      <ChevronDown size={10} className={`transition-transform ${winSku === r.id ? "rotate-180" : ""}`} />
                      {r.windowDays != null || (r.excludeDays ?? 0) > 0 ? "Custom window" : "Override window"}
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-[15px] font-medium leading-none tabular text-ink">{n(r.totalUnits)}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">Units</div>
                </div>
                <div className="min-w-0">
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
                    {segs.map((x) => (
                      <div key={x.place.id} style={{ width: `${(x.units / total) * 100}%`, background: KIND_COLOR[x.place.kind] }} title={`${x.place.code}: ${n(x.units)}`} />
                    ))}
                    {production > 0 && <div style={{ width: `${(production / total) * 100}%`, background: SEG.production }} />}
                  </div>
                  <div className="mt-1.5 text-[11px] tabular text-muted">{parts.join(" · ") || "Nothing anywhere"}</div>
                </div>
                <div>
                  <div className="tabular text-[15px] font-medium leading-none text-ink">{mo(r.coverMonths)}<span className="text-[10.5px] font-normal text-muted"> mo</span></div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">Everything owned</div>
                  {production > 0 && (
                    <div className="mt-1.5 tabular text-[13px] font-medium leading-none" style={{ color: SEG.production }}>
                      {n(production)}<span className="text-[10.5px] font-normal text-muted"> in production</span>
                    </div>
                  )}
                </div>
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: st.bg, color: st.fg, border: `1px solid ${st.bd}` }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.dot }} />
                    {r.statusLabel}
                    <HoverHint {...STATUS_HELP[r.status]} size={11} />
                  </span>
                  {r.note && <div className="mt-1 text-[10px] text-muted">{r.note}</div>}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <div className="text-right">
                    {(() => {
                      const acts: { label: string; sub: string }[] = [];
                      const moves = r.places.filter((p) => p.moveUnits > 0);
                      if (moves.length) acts.push({ label: `Move ${n(moves.reduce((t, p) => t + p.moveUnits, 0))} units`, sub: moves.map((p) => `${p.moveFrom.map((f) => `${n(f.units)} ${f.code}`).join(" + ")} → ${p.place.code}`).join(" · ") });
                      else if (r.ship) acts.push({ label: "Stock needed", sub: "no route can bring any" });
                      if (r.expedite) acts.push({ label: "Expedite", sub: "Incoming lot" });
                      if (r.recommendedQty > 0) acts.push({ label: `Order ${n(r.recommendedQty)} units`, sub: r.split.length > 1 ? r.split.map((s) => `${n(s.units)} ${s.code}`).join(" · ") : "Recommended" });
                      if (acts.length === 0) return <span className="text-[12px] text-muted">Covered</span>;
                      return acts.map((a, k) => (
                        <div key={a.label} className={k > 0 ? "mt-1.5" : ""}>
                          <div className="text-[12.5px] font-medium tabular" style={{ color: st.fg }}>{a.label}</div>
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
                      editSku === r.id || hasPolicyOverride ? "border-accent-strong bg-accent-soft text-accent" : "border-border bg-surface-2 text-muted hover:border-accent-strong hover:bg-accent-soft/40 hover:text-accent"
                    }`}
                  >
                    <Settings size={13} />
                  </button>
                </div>
              </div>

              {/* One line per place the product sells from or sits at. */}
              {r.places.length > 0 && (
                <div className="border-t border-line bg-surface-2/40">
                  {r.places.map((p, k) => <PlaceLine key={p.place.id} p={p} n={n} last={k === r.places.length - 1} />)}
                </div>
              )}

              {winSku === r.id && (
                <WindowOverrideEditor
                  row={r}
                  globalWin={win}
                  pending={pending}
                  onSave={(wd, ex) => start(async () => { await setSkuWindow(r.id, wd, ex); setWinSku(null); router.refresh(); })}
                  onClear={() => start(async () => { await setSkuWindow(r.id, null, null); setWinSku(null); router.refresh(); })}
                  bordered={false}
                />
              )}
              {editSku === r.id && (
                <SkuPolicyEditor
                  row={r}
                  defaults={defaults}
                  pending={pending}
                  onSave={(pol) => start(async () => { await updateSkuPolicy(r.id, pol); setEditSku(null); router.refresh(); })}
                  bordered={false}
                />
              )}
            </div>
          );
        })}
       </div>
      </div>
      {realPlaces.length === 0 && <p className="mt-3 text-[12px] text-muted">No facilities yet — connect a channel or add a facility and the places appear here.</p>}
    </div>
  );
}

const KIND_ORDER: Record<Place["kind"], number> = { AMAZON_FBA: 0, AMAZON_AWD: 1, own: 2, SHOPIFY: 3, TIKTOK: 4, none: 5 };

function PlaceLine({ p, n, last }: { p: PlaceResult; n: (v: number) => string; last: boolean }) {
  const st = STATUS[p.status];
  const kind = p.place.kind;
  const units = p.sellable + p.inbound;
  const acts: { label: string; sub: string }[] = [];
  if (p.moveUnits > 0) acts.push({ label: `Move ${n(p.moveUnits)} here`, sub: `from ${p.moveFrom.map((f) => `${n(f.units)} ${f.code}`).join(" + ")}${p.shipWithinDays > 0 ? ` · within ${p.shipWithinDays}d` : ""}` });
  else if (p.ship) acts.push({ label: "Stock needed", sub: p.reserve > 0 ? "donors already spoken for" : "no route brings any" });
  if (p.expedite) acts.push({ label: "Expedite", sub: "Incoming lot" });
  if (p.order && !p.expedite && acts.length === 0 && kind !== "none") acts.push({ label: "Needs the run", sub: "counts toward the order above" });
  return (
    <div className={`grid ${PLACE_GRID} items-center gap-4 px-4 py-1.5 pl-[58px] text-[12px] ${last ? "" : "border-b border-line"}`}>
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-sm" style={{ background: KIND_COLOR[kind] }} />
        <span className="min-w-0 leading-snug">
          <span className="font-medium text-ink">{p.place.code}</span>
          <span className="ml-1.5 text-[11px] text-muted">{KIND_LABEL[kind]}</span>
        </span>
      </div>
      <div className="tabular text-ink">{kind === "none" ? "—" : n(units)}</div>
      <div className="text-[11px] tabular leading-snug text-muted">
        {kind === "none"
          ? "These orders have no place yet. Their sales count; their stock can't be checked. To place them: Orders tab, filter “No facility”, set “Fulfilled at”."
          : [
              p.inbound > 0 && `${n(p.inbound)} inbound`,
              p.reserve > 0 && `${n(p.reserve)} reachable from ${p.reserveFrom.map((d) => `${n(d.units)} ${d.code}`).join(" + ")}`,
              p.production > 0 && `${n(p.production)} in production that can reach here`,
            ]
              .filter(Boolean)
              .join(" · ") || "nothing on the way"}
      </div>
      <div className="tabular text-ink">
        {p.selling ? (<>{mo(p.onHandCover)}<span className="text-[10.5px] text-muted"> mo</span> <span className="text-[10.5px] text-muted">· {n(p.monthly)}/mo</span></>) : <span className="text-muted">—</span>}
      </div>
      <div>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-px text-[10.5px] font-medium" style={{ background: st.bg, color: st.fg, border: `1px solid ${st.bd}` }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.dot }} />
          {p.statusLabel}
        </span>
        {p.note && <div className="mt-0.5 text-[10px] text-muted">{p.note}</div>}
      </div>
      <div className="text-right">
        {acts.length === 0 ? <span className="text-[11px] text-muted">{p.selling ? "Covered" : ""}</span> : acts.map((a, k) => (
          <div key={a.label} className={k > 0 ? "mt-1" : ""}>
            <div className="text-[12px] font-medium tabular" style={{ color: st.fg }}>{a.label}</div>
            <div className="text-[10.5px] text-muted">{a.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
