"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Check, Plus, X, Move, Scaling, Bell, AlertTriangle, Gauge } from "lucide-react";
import { Card, SectionTitle } from "@/components/ui";
import { TotalValueCard } from "@/components/TotalValueCard";
import { FacilityPie } from "@/components/FacilityPie";
import { ValueStackedChart } from "@/components/ValueStackedChart";
import { RecentLots, type RecentLot } from "@/components/RecentLots";
import type { RestockTotals, ValueHistoryPoint } from "@/lib/restock";
import type { Alert } from "@/lib/alerts";
import { saveDashboardLayout, dismissNotification } from "@/app/settings/actions";

const COLS = 12;
const ROW_H = 80;
const GAP = 16;
const MOBILE_MAX = 640;

type Item = { id: string; x: number; y: number; w: number; h: number };

export type DashboardData = {
  totals: RestockTotals;
  history: ValueHistoryPoint[];
  facility: { code: string; value: number }[];
  counts: { purchases: number; transactions: number; suppliers: number };
  recentLots: RecentLot[];
  alerts: Alert[];
};

type Meta = { title: string; minW: number; minH: number; w: number; h: number };
const WIDGETS: Record<string, Meta> = {
  totalValue: { title: "Total inventory value", minW: 5, minH: 3, w: 12, h: 4 },
  facility: { title: "Value by facility", minW: 3, minH: 5, w: 5, h: 6 },
  recentLots: { title: "Recent production lots", minW: 4, minH: 4, w: 7, h: 6 },
  valueByBucket: { title: "Value by bucket", minW: 4, minH: 3, w: 6, h: 4 },
  notifications: { title: "Notifications", minW: 3, minH: 3, w: 5, h: 4 },
  reorderAlerts: { title: "Reorder alerts", minW: 3, minH: 3, w: 4, h: 3 },
  daysCover: { title: "Months of cover", minW: 2, minH: 2, w: 3, h: 2 },
};

const DEFAULT_LAYOUT: Item[] = [
  { id: "totalValue", x: 0, y: 0, w: 12, h: 4 },
  { id: "notifications", x: 0, y: 4, w: 5, h: 4 },
  { id: "reorderAlerts", x: 5, y: 4, w: 4, h: 4 },
  { id: "daysCover", x: 9, y: 4, w: 3, h: 2 },
  { id: "facility", x: 0, y: 8, w: 5, h: 6 },
  { id: "recentLots", x: 5, y: 8, w: 7, h: 6 },
  { id: "valueByBucket", x: 0, y: 14, w: 12, h: 4 },
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
  const addRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
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
        backgroundImage: "radial-gradient(circle, rgba(37,99,235,0.30) 2px, transparent 2px)",
        backgroundSize: `${cellW + GAP}px ${ROW_H + GAP}px`,
        backgroundPosition: "0 0",
      }
    : undefined;

  return (
    <div ref={wrapRef}>
      {/* Toolbar */}
      <div className="mb-3 flex items-center justify-end gap-2">
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
        {!isMobile && (
          <button
            onClick={() => { if (editing) persist(itemsRef.current); setEditing((v) => !v); setAddOpen(false); }}
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
            <div key={it.id} style={{ minHeight: it.h * ROW_H }}>{renderContent(it.id, data)}</div>
          ))}
        </div>
      ) : (
        <div className={`relative rounded-xl transition-colors duration-200 ${editing ? "bg-accent-soft/30" : ""}`} style={{ height: gridH, ...dots }}>
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
                  className={`relative h-full ${editing ? "cursor-grab rounded-xl ring-1 ring-accent-strong/40 ring-offset-2 ring-offset-[var(--color-bg,#fff)] active:cursor-grabbing" : ""}`}
                >
                  <div className={`h-full ${editing ? "pointer-events-none select-none" : ""}`}>{renderContent(it.id, data)}</div>

                  {editing && (
                    <>
                      <div className="absolute left-1.5 top-1.5 z-10 rounded-md bg-ink/80 p-1 text-white shadow-sm" title="Drag to move">
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
                        className="absolute bottom-1.5 right-1.5 z-10 cursor-se-resize rounded-md bg-ink/80 p-1 text-white shadow-sm"
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
    case "valueByBucket":
      return (
        <Card className="h-full">
          <SectionTitle>Inventory value by bucket</SectionTitle>
          <ValueStackedChart data={d.history} />
        </Card>
      );
    case "notifications":
      return <NotificationsWidget alerts={d.alerts} />;
    case "reorderAlerts":
      return <ReorderAlertsWidget alerts={d.alerts} />;
    case "daysCover":
      return <CoverWidget months={d.totals.coverMonths} />;
    default:
      return null;
  }
}

function CoverWidget({ months }: { months: number }) {
  const target = 12;
  const frac = Math.max(0.03, Math.min(1, months / target));
  const healthy = months >= 6;
  const bar = healthy ? "linear-gradient(90deg,#2563eb,#60a5fa)" : "linear-gradient(90deg,#ea580c,#f59e0b)";
  return (
    <Card className="flex h-full flex-col justify-between overflow-hidden bg-gradient-to-br from-accent-soft/70 to-surface">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-ink-soft">Months of cover</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent"><Gauge size={15} /></span>
      </div>
      <div className="flex items-end gap-1">
        <span className="text-[34px] font-semibold leading-none tabular text-ink">{months.toFixed(1)}</span>
        <span className="mb-1 text-[13px] font-medium text-muted">mo</span>
      </div>
      <div>
        <div className="h-2 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full transition-all" style={{ width: `${frac * 100}%`, background: bar }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[10.5px] text-muted">
          <span>at today’s sell-through</span>
          <span>target {target}mo</span>
        </div>
      </div>
    </Card>
  );
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

const SEV: Record<Alert["severity"], { bg: string; border: string; dot: string }> = {
  critical: { bg: "#fef2f2", border: "#fecaca", dot: "#dc2626" },
  warn: { bg: "#fff7ed", border: "#fed7aa", dot: "#ea580c" },
};

function NotificationsWidget({ alerts }: { alerts: Alert[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  function dismiss(key: string) {
    setBusy(key);
    start(async () => { await dismissNotification(key); router.refresh(); });
  }
  return (
    <Card className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <Bell size={15} className="text-ink-soft" />
        <SectionTitle>Notifications</SectionTitle>
        {alerts.length > 0 && <span className="ml-auto rounded-full bg-negative px-1.5 py-0.5 text-[10px] font-semibold text-white">{alerts.length}</span>}
      </div>
      {alerts.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[12.5px] text-muted">All clear — nothing needs attention.</div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {alerts.map((a) => {
            const s = SEV[a.severity];
            return (
              <div key={a.key} className="flex items-start gap-2.5 rounded-lg border px-3 py-2" style={{ background: s.bg, borderColor: s.border }}>
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: s.dot }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-ink">{a.title}</div>
                  <div className="text-[11px] text-muted">{a.detail}</div>
                </div>
                <button onClick={() => dismiss(a.key)} disabled={busy === a.key} title="Dismiss" className="shrink-0 rounded-md p-0.5 text-muted hover:bg-black/5 hover:text-ink-soft disabled:opacity-40">
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ReorderAlertsWidget({ alerts }: { alerts: Alert[] }) {
  const reorder = alerts.filter((a) => a.kind === "reorder");
  const expedite = alerts.filter((a) => a.kind === "expedite");
  return (
    <Card className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle size={15} className="text-warn" />
        <SectionTitle>Reorder alerts</SectionTitle>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
          <div className="text-[22px] font-semibold tabular" style={{ color: reorder.length ? "#ea580c" : undefined }}>{reorder.length}</div>
          <div className="text-[11px] text-muted">need a PO</div>
        </div>
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
          <div className="text-[22px] font-semibold tabular" style={{ color: expedite.length ? "#dc2626" : undefined }}>{expedite.length}</div>
          <div className="text-[11px] text-muted">to expedite</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {[...reorder, ...expedite].slice(0, 8).map((a) => (
          <div key={a.key} className="flex items-center gap-2 text-[12px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: a.kind === "reorder" ? "#ea580c" : "#dc2626" }} />
            <span className="truncate text-ink-soft">{a.title.replace(" needs a PO", "").replace(" — expedite incoming lot", "")}</span>
            <span className="ml-auto shrink-0 text-[11px] text-muted">{a.detail}</span>
          </div>
        ))}
        {reorder.length + expedite.length === 0 && <div className="flex flex-1 items-center justify-center py-3 text-[12.5px] text-muted">Nothing to reorder 🎉</div>}
      </div>
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
