"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Check, Plus, X, Move, Scaling } from "lucide-react";
import { money, qty } from "@/lib/format";
import { Card, SectionTitle } from "@/components/ui";
import { TotalValueCard } from "@/components/TotalValueCard";
import { FacilityPie } from "@/components/FacilityPie";
import { RecentLots, type RecentLot } from "@/components/RecentLots";
import type { RestockTotals } from "@/lib/restock";
import { saveDashboardLayout } from "@/app/settings/actions";

const COLS = 12;
const ROW_H = 80;
const GAP = 16;
const MOBILE_MAX = 640;

type Item = { id: string; x: number; y: number; w: number; h: number };

export type DashboardData = {
  totals: RestockTotals;
  history: { day: string; total: number }[];
  facility: { code: string; value: number }[];
  counts: { purchases: number; transactions: number; suppliers: number };
  recentLots: RecentLot[];
  rawInventoryValue: number;
  inProductionValue: number;
  totalUnits: number;
};

type Meta = { title: string; minW: number; minH: number; w: number; h: number };
const WIDGETS: Record<string, Meta> = {
  totalValue: { title: "Total inventory value", minW: 5, minH: 3, w: 12, h: 4 },
  facility: { title: "Value by facility", minW: 3, minH: 4, w: 5, h: 5 },
  recentLots: { title: "Recent production lots", minW: 4, minH: 4, w: 7, h: 5 },
  daysCover: { title: "Months of cover", minW: 2, minH: 2, w: 3, h: 2 },
  rawValue: { title: "Raw inventory value", minW: 2, minH: 2, w: 3, h: 2 },
  unitsMade: { title: "Units produced", minW: 2, minH: 2, w: 3, h: 2 },
};

const DEFAULT_LAYOUT: Item[] = [
  { id: "totalValue", x: 0, y: 0, w: 12, h: 4 },
  { id: "facility", x: 0, y: 4, w: 5, h: 5 },
  { id: "recentLots", x: 5, y: 4, w: 7, h: 5 },
];

// ---- geometry helpers ----
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
  const items = raw
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
  // de-dupe by id (keep first)
  const seen = new Set<string>();
  const uniq = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  return uniq.length ? compact(uniq) : DEFAULT_LAYOUT;
}

export function DashboardGrid({ data, initialLayout }: { data: DashboardData; initialLayout: unknown }) {
  const [items, setItems] = useState<Item[]>(() => sanitize(initialLayout));
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [, startSave] = useTransition();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

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

  const persist = useCallback((next: Item[]) => startSave(async () => { try { await saveDashboardLayout(next); } catch { /* layout save is best-effort */ } }), []);

  // ---- drag / resize via pointer ----
  const op = useRef<{ id: string; mode: "move" | "resize"; px: number; py: number; orig: Item } | null>(null);

  function onPointerDown(e: React.PointerEvent, id: string, mode: "move" | "resize") {
    if (!editing || isMobile) return;
    e.preventDefault();
    const orig = items.find((i) => i.id === id);
    if (!orig) return;
    op.current = { id, mode, px: e.clientX, py: e.clientY, orig };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const o = op.current;
      if (!o) return;
      const stepX = cellW + GAP;
      const stepY = ROW_H + GAP;
      const dx = Math.round((e.clientX - o.px) / stepX);
      const dy = Math.round((e.clientY - o.py) / stepY);
      const m = WIDGETS[o.id];
      setItems((prev) =>
        prev.map((it) => {
          if (it.id !== o.id) return it;
          if (o.mode === "move") {
            const x = Math.max(0, Math.min(COLS - o.orig.w, o.orig.x + dx));
            const y = Math.max(0, o.orig.y + dy);
            return { ...it, x, y };
          }
          const w = Math.max(m.minW, Math.min(COLS - o.orig.x, o.orig.w + dx));
          const h = Math.max(m.minH, o.orig.h + dy);
          return { ...it, w, h };
        })
      );
    },
    [cellW]
  );

  const onPointerUp = useCallback(() => {
    window.removeEventListener("pointermove", onPointerMove);
    op.current = null;
    setItems((prev) => {
      const next = compact(prev);
      persist(next);
      return next;
    });
  }, [onPointerMove, persist]);

  function removeWidget(id: string) {
    setItems((prev) => {
      const next = compact(prev.filter((i) => i.id !== id));
      persist(next);
      return next;
    });
  }

  function addWidget(id: string) {
    setAddOpen(false);
    setItems((prev) => {
      if (prev.some((i) => i.id === id)) return prev;
      const m = WIDGETS[id];
      const y = prev.reduce((mx, i) => Math.max(mx, i.y + i.h), 0);
      const next = compact([...prev, { id, x: 0, y, w: m.w, h: m.h }]);
      persist(next);
      return next;
    });
  }

  const available = useMemo(() => Object.keys(WIDGETS).filter((k) => !items.some((i) => i.id === k)), [items]);
  const ordered = useMemo(() => [...items].sort((a, b) => a.y - b.y || a.x - b.x), [items]);

  const dots = editing
    ? {
        backgroundImage: "radial-gradient(circle, var(--color-border, #e5e5e5) 1.5px, transparent 1.5px)",
        backgroundSize: `${cellW + GAP}px ${ROW_H + GAP}px`,
        backgroundPosition: "-1px -1px",
      }
    : undefined;

  return (
    <div ref={wrapRef}>
      {/* Toolbar */}
      <div className="mb-3 flex items-center justify-end gap-2">
        {editing && (
          <div className="relative">
            <button
              onClick={() => setAddOpen((v) => !v)}
              disabled={available.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-surface-2 disabled:opacity-50"
            >
              <Plus size={14} /> Add widget
            </button>
            {addOpen && available.length > 0 && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
                {available.map((k) => (
                  <button key={k} onClick={() => addWidget(k)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink-soft hover:bg-surface-2">
                    <Plus size={13} className="text-muted" /> {WIDGETS[k].title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {!isMobile && (
          <button
            onClick={() => { setEditing((v) => !v); setAddOpen(false); }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              editing ? "bg-ink text-white" : "border border-border bg-surface text-ink-soft hover:bg-surface-2"
            }`}
          >
            {editing ? <><Check size={14} /> Done</> : <><Pencil size={14} /> Edit dashboard</>}
          </button>
        )}
      </div>

      {/* Grid */}
      {isMobile ? (
        <div className="space-y-4">
          {ordered.map((it) => (
            <div key={it.id} style={{ minHeight: it.h * ROW_H }}>
              {renderContent(it.id, data)}
            </div>
          ))}
        </div>
      ) : (
        <div className="relative rounded-xl transition-[background] duration-200" style={{ height: gridH, ...dots }}>
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
                  className={`group relative h-full ${editing ? "cursor-grab rounded-xl ring-1 ring-accent-strong/40 ring-offset-2 ring-offset-[var(--color-bg,#fff)] active:cursor-grabbing" : ""}`}
                >
                  <div className={`h-full ${editing ? "pointer-events-none select-none" : ""}`}>{renderContent(it.id, data)}</div>

                  {editing && (
                    <>
                      {/* drag hint (top-left) */}
                      <div className="absolute left-1.5 top-1.5 z-10 rounded-md bg-ink/80 p-1 text-white shadow-sm" title="Drag to move">
                        <Move size={12} />
                      </div>
                      {/* remove (top-right) */}
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => removeWidget(it.id)}
                        title="Remove widget"
                        className="absolute right-1.5 top-1.5 z-10 rounded-md bg-negative/90 p-1 text-white shadow-sm hover:bg-negative"
                      >
                        <X size={12} />
                      </button>
                      {/* resize handle (bottom-right) */}
                      <div
                        onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, it.id, "resize"); }}
                        title="Drag to resize"
                        className="absolute bottom-0 right-0 z-10 flex h-6 w-6 cursor-se-resize items-center justify-center rounded-tl-md bg-ink/80 text-white"
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
    case "facility":
      return <FacilityWidget data={d.facility} counts={d.counts} />;
    case "recentLots":
      return <RecentLotsWidget lots={d.recentLots} />;
    case "daysCover":
      return <StatWidget label="Months of cover" value={`${d.totals.coverMonths.toFixed(1)} mo`} sub="at current sell-through" />;
    case "rawValue":
      return <StatWidget label="Raw inventory value" value={money(d.rawInventoryValue)} sub="tea bags + pouches (FIFO)" />;
    case "unitsMade":
      return <StatWidget label="Units produced" value={qty(d.totalUnits)} sub="across all lots" />;
    default:
      return null;
  }
}

function FacilityWidget({ data, counts }: { data: { code: string; value: number }[]; counts: { purchases: number; transactions: number; suppliers: number } }) {
  return (
    <Card className="flex h-full flex-col">
      <SectionTitle>Production value by facility</SectionTitle>
      <FacilityPie data={data} />
      <div className="mt-auto grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
        <Mini label="Purchases" value={counts.purchases} />
        <Mini label="Transactions" value={counts.transactions} />
        <Mini label="Suppliers" value={counts.suppliers} />
      </div>
    </Card>
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

function StatWidget({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="flex h-full flex-col justify-center">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1 text-[26px] font-semibold leading-none tabular text-ink">{value}</div>
      <div className="mt-1.5 text-[11.5px] text-muted">{sub}</div>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[18px] font-semibold text-ink tabular">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}
