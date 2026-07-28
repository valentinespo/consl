"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Check, Plus, X, Move, Scaling, CheckCircle2 } from "@/components/icons";
import { useMoney } from "@/components/CurrencyProvider";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { TotalValueCard } from "@/components/TotalValueCard";
import { Donut, RAMP, type Slice } from "@/components/Donut";
import { ValueStackedChart } from "@/components/ValueStackedChart";
import { RecentLots, type RecentLot } from "@/components/RecentLots";
import type { RestockTotals, ValueHistoryPoint } from "@/lib/restock";
import type { Alert } from "@/lib/alerts";
import type { LeadTimes } from "@/lib/queries";
import { saveDashboardLayout } from "@/app/settings/actions";

const COLS = 12;
const ROW_H = 80;
const GAP = 16;
const MOBILE_MAX = 640;

type Item = { id: string; x: number; y: number; w: number; h: number };

export type DashboardData = {
  totals: RestockTotals;
  history: ValueHistoryPoint[];
  facility: { code: string; value: number }[]; // produced (lot) value per producing facility
  prodTotal: number;
  spentBySupplier: Slice[]; // purchases + COG transactions per supplier
  spentTotal: number;
  recentLots: RecentLot[];
  alerts: Alert[];
  leadTimes: LeadTimes & { configuredDays: number };
};

type Meta = { title: string; minW: number; minH: number; w: number; h: number };
const WIDGETS: Record<string, Meta> = {
  totalValue: { title: "Total inventory value", minW: 5, minH: 3, w: 12, h: 4 },
  producedValue: { title: "Produced value", minW: 3, minH: 5, w: 4, h: 6 },
  amountSpent: { title: "Amount spent", minW: 3, minH: 5, w: 4, h: 6 },
  recentLots: { title: "Recent production lots", minW: 4, minH: 4, w: 7, h: 6 },
  valueByBucket: { title: "Value by bucket", minW: 4, minH: 3, w: 6, h: 4 },
  reorderAlerts: { title: "Reorder alerts", minW: 3, minH: 3, w: 4, h: 3 },
  daysCover: { title: "Months of cover", minW: 2, minH: 2, w: 3, h: 2 },
  leadTime: { title: "Production lead time", minW: 4, minH: 3, w: 4, h: 5 },
};

const DEFAULT_LAYOUT: Item[] = [
  { id: "totalValue", x: 0, y: 0, w: 12, h: 4 },
  { id: "reorderAlerts", x: 0, y: 4, w: 5, h: 4 },
  { id: "daysCover", x: 5, y: 4, w: 3, h: 2 },
  { id: "leadTime", x: 8, y: 4, w: 4, h: 4 },
  { id: "producedValue", x: 0, y: 8, w: 4, h: 6 },
  { id: "amountSpent", x: 4, y: 8, w: 4, h: 6 },
  { id: "recentLots", x: 8, y: 8, w: 4, h: 6 },
  { id: "valueByBucket", x: 0, y: 14, w: 8, h: 4 },
];

const overlap = (a: Item, b: Item) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Gravity-up compaction that also resolves overlaps by pushing items down. */
function compact(items: Item[]): Item[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: Item[] = [];
  for (const it of sorted) {
    let y = it.y;
    while (y > 0 && !placed.some((p) => overlap({ ...it, y: y - 1 }, p))) y--;
    while (placed.some((p) => overlap({ ...it, y }, p))) y++;
    placed.push({ ...it, y });
  }
  return placed;
}

function sanitize(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return DEFAULT_LAYOUT;
  // The old combined "facility" widget became "Produced value"; keep its slot on existing dashboards.
  let migrated = false;
  const items = raw
    .map((r) => {
      if (r && typeof r === "object" && (r as Item).id === "facility") {
        migrated = true;
        return { ...(r as Item), id: "producedValue" };
      }
      return r;
    })
    .filter((r): r is Item => !!r && typeof r === "object" && typeof (r as Item).id === "string" && !!WIDGETS[(r as Item).id])
    .map((r) => {
      const m = WIDGETS[r.id];
      return {
        id: r.id,
        x: Math.max(0, Math.min(COLS - m.minW, Math.round(r.x) || 0)),
        y: Math.max(0, Math.round(r.y) || 0),
        w: Math.max(m.minW, Math.min(COLS, Math.round(r.w) || m.w)),
        h: Math.max(m.minH, Math.round(r.h) || m.h),
      };
    });
  const seen = new Set<string>();
  let uniq = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  // On that same migration, drop the new "Amount spent" widget in beside it so both show up.
  const pv = uniq.find((i) => i.id === "producedValue");
  if (migrated && pv && !uniq.some((i) => i.id === "amountSpent")) {
    uniq = [...uniq, { id: "amountSpent", x: pv.x, y: pv.y + pv.h, w: pv.w, h: pv.h }];
  }
  return uniq.length ? compact(uniq) : DEFAULT_LAYOUT;
}

export function DashboardGrid({
  data,
  initialLayout,
  title,
  subtitle,
  banner,
}: {
  data: DashboardData;
  initialLayout: unknown;
  title: string;
  subtitle?: string;
  // Rendered between the header and the grid (the Getting Started checklist). Passed from the
  // server page so the grid owns the whole header→banner→grid stack and the Edit button can sit
  // inline with the title instead of in a half-empty row of its own.
  banner?: React.ReactNode;
}) {
  const [items, setItems] = useState<Item[]>(() => sanitize(initialLayout));
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Snapshot of the layout as it was when editing began, so Cancel can restore it — drags
  // autosave as they happen, so reverting means writing the snapshot back, not just closing.
  const preEdit = useRef<Item[]>(items);
  const [, startSave] = useTransition();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  // Close the add-widget menu on outside click.
  useEffect(() => {
    if (!addOpen) return;
    const onDoc = (e: MouseEvent) => { if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [addOpen]);

  const isMobile = width > 0 && width < MOBILE_MAX;
  const cellW = width > 0 ? (width - (COLS - 1) * GAP) / COLS : 0;
  const rows = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  const gridH = rows * ROW_H + Math.max(0, rows - 1) * GAP;

  const pxOf = useCallback(
    (it: Item) => ({
      left: it.x * (cellW + GAP),
      top: it.y * (ROW_H + GAP),
      width: it.w * cellW + (it.w - 1) * GAP,
      height: it.h * ROW_H + (it.h - 1) * GAP,
    }),
    [cellW]
  );

  const persist = useCallback((next: Item[]) => startSave(async () => { try { await saveDashboardLayout(next); } catch { /* best-effort */ } }), []);
  const commit = useCallback((next: Item[]) => { const c = compact(next); setItems(c); persist(c); }, [persist]);

  // ---- drag / resize ----
  const op = useRef<{ id: string; mode: "move" | "resize"; px: number; py: number; orig: Item } | null>(null);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const o = op.current;
      if (!o) return;
      const dx = Math.round((e.clientX - o.px) / (cellW + GAP));
      const dy = Math.round((e.clientY - o.py) / (ROW_H + GAP));
      const m = WIDGETS[o.id];
      setItems((prev) =>
        prev.map((it) => {
          if (it.id !== o.id) return it;
          if (o.mode === "move") {
            return { ...it, x: Math.max(0, Math.min(COLS - o.orig.w, o.orig.x + dx)), y: Math.max(0, o.orig.y + dy) };
          }
          return { ...it, w: Math.max(m.minW, Math.min(COLS - o.orig.x, o.orig.w + dx)), h: Math.max(m.minH, o.orig.h + dy) };
        })
      );
    },
    [cellW]
  );

  const onPointerUp = useCallback(() => {
    window.removeEventListener("pointermove", onPointerMove);
    op.current = null;
    commit(itemsRef.current);
  }, [onPointerMove, commit]);

  function onPointerDown(e: React.PointerEvent, id: string, mode: "move" | "resize") {
    if (!editing || isMobile) return;
    e.preventDefault();
    const orig = itemsRef.current.find((i) => i.id === id);
    if (!orig) return;
    op.current = { id, mode, px: e.clientX, py: e.clientY, orig };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function removeWidget(id: string) {
    commit(itemsRef.current.filter((i) => i.id !== id));
  }
  function addWidget(id: string) {
    setAddOpen(false);
    if (itemsRef.current.some((i) => i.id === id)) return;
    const m = WIDGETS[id];
    const y = itemsRef.current.reduce((mx, i) => Math.max(mx, i.y + i.h), 0);
    commit([...itemsRef.current, { id, x: 0, y, w: m.w, h: m.h }]);
  }

  const available = useMemo(() => Object.keys(WIDGETS).filter((k) => !items.some((i) => i.id === k)), [items]);
  const ordered = useMemo(() => [...items].sort((a, b) => a.y - b.y || a.x - b.x), [items]);

  const dots = editing
    ? {
        backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--color-chart) 40%, transparent) 2px, transparent 2px)",
        backgroundSize: `${cellW + GAP}px ${ROW_H + GAP}px`,
        backgroundPosition: "0 0",
      }
    : undefined;

  return (
    <div ref={wrapRef}>
      {/* Title, with the edit controls inline on the right — no separate toolbar row. */}
      <PageHeader title={title} subtitle={subtitle}>
        <div className="flex items-center gap-2">
          {editing && (
            <div ref={addRef} className="relative">
              <button
                onClick={() => setAddOpen((v) => !v)}
                disabled={available.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-surface-2 disabled:opacity-50"
              >
                <Plus size={14} /> Add widget
              </button>
              {addOpen && available.length > 0 && (
                <div className="absolute right-0 top-full z-40 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
                  {available.map((k) => (
                    <button key={k} onClick={() => addWidget(k)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink-soft hover:bg-surface-2">
                      <Plus size={13} className="text-muted" /> {WIDGETS[k].title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!isMobile && editing && (
            <button
              onClick={() => { setItems(preEdit.current); persist(preEdit.current); setEditing(false); setAddOpen(false); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:bg-surface-2"
            >
              <X size={14} /> Cancel
            </button>
          )}
          {!isMobile && (
            <button
              onClick={() => {
                if (editing) { persist(itemsRef.current); setEditing(false); }
                else { preEdit.current = itemsRef.current; setEditing(true); }
                setAddOpen(false);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                editing ? "bg-ink text-bg" : "border border-border bg-surface text-ink-soft hover:bg-surface-2"
              }`}
            >
              {editing ? <><Check size={14} /> Done</> : <><Pencil size={14} /> Edit dashboard</>}
            </button>
          )}
        </div>
      </PageHeader>

      {banner}

      {/* Grid */}
      {isMobile ? (
        <div className="space-y-4">
          {ordered.map((it) => (
            <div key={it.id} className="overflow-hidden rounded-[var(--radius-card)]" style={{ minHeight: it.h * ROW_H }}>{renderContent(it.id, data)}</div>
          ))}
        </div>
      ) : (
        <div className={`relative rounded-xl transition-colors duration-200 ${editing ? "bg-chart-soft/40" : ""}`} style={{ height: gridH, ...dots }}>
          {items.map((it) => {
            const p = pxOf(it);
            return (
              <div
                key={it.id}
                style={{ position: "absolute", left: p.left, top: p.top, width: p.width, height: p.height }}
                className={`transition-[left,top,width,height] duration-150 ${op.current?.id === it.id ? "z-20" : ""}`}
              >
                <div
                  onPointerDown={(e) => onPointerDown(e, it.id, "move")}
                  className={`relative h-full ${editing ? "cursor-grab rounded-xl ring-1 ring-chart/50 ring-offset-2 ring-offset-[var(--color-bg,#fff)] active:cursor-grabbing" : ""}`}
                >
                  <div className={`h-full overflow-hidden rounded-[var(--radius-card)] ${editing ? "pointer-events-none select-none" : ""}`}>{renderContent(it.id, data)}</div>

                  {editing && (
                    <>
                      <div className="absolute left-1.5 top-1.5 z-10 rounded-md bg-ink/80 p-1 text-bg shadow-sm" title="Drag to move">
                        <Move size={12} />
                      </div>
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => removeWidget(it.id)}
                        title="Remove widget"
                        className="absolute right-1.5 top-1.5 z-10 rounded-md bg-negative/90 p-1 text-white shadow-sm hover:bg-negative"
                      >
                        <X size={12} />
                      </button>
                      <div
                        onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, it.id, "resize"); }}
                        title="Drag to resize"
                        className="absolute bottom-1.5 right-1.5 z-10 cursor-se-resize rounded-md bg-ink/80 p-1 text-bg shadow-sm"
                      >
                        <Scaling size={12} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <div className="flex h-40 items-center justify-center text-[13px] text-muted">No widgets — use “Add widget”.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- widget content ----
function renderContent(id: string, d: DashboardData) {
  switch (id) {
    case "totalValue":
      return <TotalValueCard totals={d.totals} history={d.history} className="h-full" />;
    case "producedValue":
      return (
        <RingWidget
          title="Produced value"
          subtitle="Lot value by producing facility"
          data={d.facility.map((f) => ({ label: f.code, value: f.value }))}
          total={d.prodTotal}
        />
      );
    case "amountSpent":
      return <RingWidget title="Amount spent" subtitle="Purchases and production costs by supplier" data={d.spentBySupplier} total={d.spentTotal} />;
    case "recentLots":
      return <RecentLotsWidget lots={d.recentLots} />;
    case "valueByBucket":
      return (
        <Card className="flex h-full flex-col">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[15px] font-semibold text-ink">Value by bucket</span>
            <span className="text-[11px] text-muted">{d.history.length >= 2 ? `${d.history.length}d` : "grows daily"}</span>
          </div>
          <div className="min-h-0 flex-1">
            <ValueStackedChart data={d.history} />
          </div>
        </Card>
      );
    case "reorderAlerts":
      return <ReorderAlertsWidget alerts={d.alerts} />;
    case "daysCover":
      return <CoverWidget months={d.totals.coverMonths} />;
    case "leadTime":
      return <LeadTimeWidget lt={d.leadTimes} />;
    default:
      return null;
  }
}

/** Months of cover as the reference's tick-bar meter: a row of violet ticks filled to the target
 *  fraction, the boundary carrying the percentage. Low cover turns the ticks amber. */
function CoverWidget({ months }: { months: number }) {
  const target = 12;
  const frac = Math.max(0, Math.min(1, months / target));
  const low = months < 3;
  const TICKS = 36;
  const filled = Math.max(months > 0 ? 1 : 0, Math.round(frac * TICKS));
  const tickColor = low ? "#ea580c" : "var(--color-chart)";
  return (
    <Card className="flex h-full flex-col justify-between">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[15px] font-semibold text-ink">Months of cover</span>
        <span className={`inline-flex items-center rounded-full px-2 py-[4px] text-[11px] font-semibold leading-none ${low ? "pill-amber" : "pill-chart"}`}>
          {Math.round(frac * 100)}% of target
        </span>
      </div>
      <div className="flex items-end gap-1.5">
        <span className="text-[30px] font-semibold leading-none tracking-tight tabular text-ink">{months.toFixed(1)}</span>
        <span className="mb-0.5 text-[13px] text-muted">mo</span>
      </div>
      <div>
        <div className="flex h-6 items-stretch gap-[3px]">
          {Array.from({ length: TICKS }, (_, i) => (
            <span
              key={i}
              className="min-w-0 flex-1 rounded-full"
              style={{
                background: i < filled ? tickColor : "color-mix(in srgb, var(--color-chart) 14%, transparent)",
              }}
            />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[10.5px] text-muted">
          <span>At today’s sell-through</span>
          <span>Target {target}mo</span>
        </div>
      </div>
    </Card>
  );
}

// The donut is a FIXED size — the diameter it has in the default 4×5-point widget — and never
// grows with the card. Extra room goes to the breakdown, which shows at least MIN_ROWS slots
// (padding with "awaiting data" placeholders when there's less) and scrolls once the rows
// outrun the space: 3 fit under the donut in a portrait card, more when it's widened or made
// taller. So the widget reads the same at any size the user drags it to.
const DONUT_PX = 190;
const MIN_ROWS = 3;
const ROW_PX = 30; // one breakdown row's height — sets the portrait scroll threshold

/** A scroll container that fades its content at whichever edge has more beyond it — a reliable,
 *  browser-independent "there's more below/above" signal (native overlay scrollbars auto-hide and
 *  `scrollbar-gutter` isn't honoured everywhere, so we don't depend on them). Keeps the styled
 *  scrollbar too, for browsers that show it. `center` vertically centres the rows when they don't
 *  fill the height (the wide layout) yet still scrolls from the top once they overflow. */
function ScrollFade({ children, wrapClassName = "", scrollStyle, center = false, contentClassName = "space-y-1" }: { children: React.ReactNode; wrapClassName?: string; scrollStyle?: React.CSSProperties; center?: boolean; contentClassName?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ top: false, bottom: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ top: el.scrollTop > 2, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 2 });
  }, []);
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, children]);
  return (
    <div className={`relative ${wrapClassName}`}>
      <div ref={ref} onScroll={update} className="h-full overflow-y-auto scroll-visible" style={scrollStyle}>
        <div className={`${contentClassName} ${center ? "flex min-h-full flex-col justify-center" : ""}`}>{children}</div>
      </div>
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-surface to-transparent transition-opacity duration-150 ${edge.top ? "opacity-100" : "opacity-0"}`} />
      <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-surface to-transparent transition-opacity duration-150 ${edge.bottom ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}

/** One wheel with a labelled breakdown and the grand total pinned to the bottom. Used for both
 *  "Produced value" (by facility) and "Amount spent" (by supplier) — same violet ring. Portrait
 *  cards stack the donut over the rows; wide cards sit the donut on the left with the rows
 *  filling the height beside it. */
function RingWidget({ title, subtitle, data, total }: { title: string; subtitle: string; data: Slice[]; total: number }) {
  const { money } = useMoney();
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const wide = box.w > box.h * 1.2;
  // Fixed diameter, only ever shrinking if the card is genuinely smaller than it (so it can't
  // overflow a min-size widget) — never growing past the 4×5 size.
  const donutPx = Math.max(120, Math.min(DONUT_PX, box.w || DONUT_PX, wide ? box.h || DONUT_PX : Infinity));

  const slots = Math.max(MIN_ROWS, data.length);
  const rows = Array.from({ length: slots }, (_, i) => data[i] ?? null);

  const legend = (
    <>
      {rows.map((s, i) =>
        s ? (
          <div
            key={s.label}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 text-[12.5px] transition-colors"
            style={{ background: hover === i ? "var(--color-surface-2)" : "transparent" }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="h-4 w-1.5 shrink-0 rounded-full" style={{ background: RAMP[i % RAMP.length] }} />
            <span className="truncate font-medium text-ink-soft">{s.label}</span>
            <span className="ml-auto shrink-0 tabular text-ink">{money(s.value)}</span>
            <span className="w-9 shrink-0 text-right tabular text-[11px] text-muted">{total > 0 ? Math.round((s.value / total) * 100) : 0}%</span>
          </div>
        ) : (
          <div key={`empty-${i}`} className="flex items-center gap-2.5 px-1.5 py-1 text-[12.5px]">
            <span className="h-4 w-1.5 shrink-0 rounded-full bg-border" />
            <span className="text-muted/70">Awaiting data</span>
          </div>
        ),
      )}
    </>
  );

  return (
    <Card className="flex h-full flex-col">
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      <div className="mt-0.5 text-[12.5px] text-muted">{subtitle}</div>
      <div ref={boxRef} className={`mt-2 min-h-0 flex-1 ${wide ? "flex gap-5" : "flex flex-col items-center justify-center gap-1"}`}>
        <div className="shrink-0 self-center" style={{ width: donutPx, height: donutPx }}>
          {data.length ? <Donut data={data} hover={hover} onHover={setHover} /> : <EmptyRing />}
        </div>
        {wide ? (
          // Fills the height beside the donut and centres its rows, scrolling only once they
          // outgrow the card.
          <ScrollFade wrapClassName="min-w-0 min-h-0 flex-1" center>{legend}</ScrollFade>
        ) : (
          <ScrollFade wrapClassName="w-full" scrollStyle={{ maxHeight: MIN_ROWS * ROW_PX }}>{legend}</ScrollFade>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <span className="text-[12.5px] text-muted">Grand total</span>
        <span className="text-[15px] font-semibold tabular text-ink">{money(total)}</span>
      </div>
    </Card>
  );
}

/** A faint, empty donut ring shown while a widget is still waiting for its first data. */
function EmptyRing() {
  return (
    <svg viewBox="0 0 140 140" className="h-full w-full" role="img" aria-label="Awaiting data">
      <circle cx="70" cy="70" r="48.5" fill="none" stroke="var(--color-line)" strokeWidth="35" />
    </svg>
  );
}

function RecentLotsWidget({ lots }: { lots: RecentLot[] }) {
  return (
    <Card className="flex h-full flex-col overflow-hidden" padded={false}>
      <div className="flex items-center justify-between px-5 pt-5">
        <SectionTitle>Recent production lots</SectionTitle>
        <Link href="/lots" className="text-[12.5px] font-medium text-accent hover:underline">View all →</Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <RecentLots lots={lots} />
      </div>
    </Card>
  );
}

/** Measured production lead time, in the reference language: a bold title with a delta chip
 *  against the configured setting, a quiet subtitle, the blended average as the headline stat,
 *  then each producing facility as a violet gradient bar — label riding inside the bar, a strong
 *  cap at its end, the value out right. Bars are relative to the slowest facility. */
function LeadTimeWidget({ lt }: { lt: DashboardData["leadTimes"] }) {
  const mo = (d: number) => (d / 30.44).toFixed(1);
  if (lt.blendedDays == null) {
    return (
      <Card className="flex h-full flex-col">
        <div className="text-[15px] font-semibold text-ink">Production lead time</div>
        <div className="flex flex-1 items-center justify-center text-[12.5px] text-muted">
          Finish a lot to start measuring
        </div>
      </Card>
    );
  }
  const diff = lt.blendedDays - lt.configuredDays;
  const onTarget = Math.abs(diff) < 4;
  const maxAvg = Math.max(...lt.perFacility.map((f) => f.avgDays), 1);
  const chip = onTarget
    ? { text: "on target", cls: "pill-neutral" }
    : diff < 0
      ? { text: `↓ ${Math.abs(diff)}d faster`, cls: "pill-green" }
      : { text: `↑ ${diff}d slower`, cls: "pill-amber" };
  return (
    <Card className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold text-ink">Production lead time</span>
        <span className={`inline-flex items-center rounded-full px-2 py-[4px] text-[11px] font-semibold leading-none ${chip.cls}`}>
          {chip.text}
        </span>
      </div>
      <div className="mt-1 truncate text-[12.5px] text-muted">
        PO to finished · {lt.lots} lots · vs {mo(lt.configuredDays)} mo
      </div>
      <div className="mt-2.5 flex items-end gap-2">
        <span className="text-[30px] font-semibold leading-none tracking-tight text-ink tabular">{mo(lt.blendedDays)}</span>
        <span className="mb-0.5 text-[13px] text-muted">mo avg · {lt.blendedDays}d</span>
      </div>
      <ScrollFade wrapClassName="mt-3.5 min-h-0 flex-1" contentClassName="space-y-2">
        {Array.from({ length: Math.max(3, lt.perFacility.length) }, (_, i) => lt.perFacility[i] ?? null).map((f, i) =>
          f ? (
            <div key={f.code} className="flex items-center gap-3">
              <div className="relative flex h-7 min-w-0 flex-1 items-center">
                <div
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${Math.max(8, (f.avgDays / maxAvg) * 100)}%`,
                    background:
                      "linear-gradient(90deg, color-mix(in srgb, var(--color-chart) 3%, transparent), color-mix(in srgb, var(--color-chart) 24%, transparent))",
                  }}
                >
                  <span className="absolute inset-y-0 right-0 w-[3px]" style={{ background: "var(--color-chart)" }} />
                </div>
                {/* The label rides over the bar, not inside it — a tiny bar can't clip its own name. */}
                <span className="relative z-10 pl-1.5 text-[12.5px] font-medium text-ink">{f.code}</span>
              </div>
              <span className="shrink-0 text-[12.5px] tabular">
                <span className="font-semibold text-ink">{mo(f.avgDays)} mo</span>
                <span className="text-muted"> · {f.lots} {f.lots === 1 ? "lot" : "lots"}</span>
              </span>
            </div>
          ) : (
            <div key={`empty-${i}`} className="flex items-center gap-3">
              <div className="relative flex h-7 min-w-0 flex-1 items-center rounded-[3px]" style={{ background: "color-mix(in srgb, var(--color-chart) 4%, transparent)" }}>
                <span className="relative z-10 pl-1.5 text-[12.5px] text-muted/70">Awaiting data</span>
              </div>
            </div>
          ),
        )}
      </ScrollFade>
    </Card>
  );
}

/** Reorder alerts in the reference language: a bold title with a need-action chip, three quiet
 *  stat columns split by hairlines — the number carries its signal colour only when non-zero —
 *  and the alert rows beneath a hairline. */
function ReorderAlertsWidget({ alerts }: { alerts: Alert[] }) {
  const reorder = alerts.filter((a) => a.kind === "reorder");
  const ship = alerts.filter((a) => a.kind === "ship");
  const expedite = alerts.filter((a) => a.kind === "expedite");
  // Same order as the inventory KPI row, so the two screens read identically.
  const list = [...reorder, ...ship, ...expedite].slice(0, 8);
  const total = list.length === 0 ? 0 : reorder.length + ship.length + expedite.length;
  const cols = [
    { label: "Need a PO", n: reorder.length, color: "#ea580c" },
    { label: "To ship", n: ship.length, color: "#8b5cf6" },
    { label: "Expedite", n: expedite.length, color: "#dc2626" },
  ];
  return (
    <Card className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold text-ink">Reorder alerts</span>
        <span className={`inline-flex items-center rounded-full px-2 py-[4px] text-[11px] font-semibold leading-none ${total ? "pill-red" : "pill-green"}`}>
          {total ? `${total} need action` : "all clear"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3">
        {cols.map((c, i) => (
          <div key={c.label} className={i > 0 ? "border-l border-line pl-4" : ""}>
            <div className="text-[11.5px] text-muted">{c.label}</div>
            <div
              className="mt-1 text-[22px] font-semibold leading-none tabular"
              style={{ color: c.n > 0 ? c.color : "var(--color-muted)" }}
            >
              {c.n}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3.5 min-h-0 flex-1 space-y-1.5 overflow-y-auto border-t border-line pt-3">
        {list.map((a) => (
          <div key={a.key} className="flex items-center gap-2 text-[12px]">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: a.kind === "reorder" ? "#ea580c" : a.kind === "ship" ? "#8b5cf6" : "#dc2626" }}
            />
            <span className="truncate text-ink-soft">
              {a.title.replace(" needs a PO", "").replace(" — expedite incoming lot", "").replace(" — ship stock you already have", "")}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-muted">{a.detail}</span>
          </div>
        ))}
        {list.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted">
            <CheckCircle2 size={24} className="text-positive" />
            <span className="text-[12.5px]">Nothing to reorder</span>
          </div>
        )}
      </div>
    </Card>
  );
}

