"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Check, Plus, X, Move, Scaling, Bell, AlertTriangle, FileText, Gauge, PieChart, Layers, CheckCircle2, ShoppingCart, Zap, PackageSearch, Truck } from "@/components/icons";
import type { LucideIcon } from "@/components/icons";
import { useMoney } from "@/components/CurrencyProvider";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { TotalValueCard } from "@/components/TotalValueCard";
import { FacilityPie, BLUES, VIOLETS } from "@/components/FacilityPie";
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
  facilityPurchases: { code: string; value: number }[];
  prodTotal: number;
  purchTotal: number;
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
          {!isMobile && (
            <button
              onClick={() => { if (editing) persist(itemsRef.current); setEditing((v) => !v); setAddOpen(false); }}
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
    case "facility":
      return <FacilityWidget production={d.facility} purchases={d.facilityPurchases} prodTotal={d.prodTotal} purchTotal={d.purchTotal} counts={d.counts} />;
    case "recentLots":
      return <RecentLotsWidget lots={d.recentLots} />;
    case "valueByBucket":
      return (
        <Card className="flex h-full flex-col">
          <WidgetHead
            icon={Layers}
            title="Value by bucket"
            tint="accent"
            right={<span className="text-[11px] text-muted">{d.history.length >= 2 ? `${d.history.length}d` : "grows daily"}</span>}
          />
          <div className="min-h-0 flex-1">
            <ValueStackedChart data={d.history} />
          </div>
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
          <span>At today’s sell-through</span>
          <span>Target {target}mo</span>
        </div>
      </div>
    </Card>
  );
}

const TINTS: Record<string, string> = {
  accent: "bg-accent-soft text-accent",
  amber: "bg-[#fff7ed] text-warn",
  red: "bg-[#fef2f2] text-negative",
  green: "bg-[#dcfce7] text-positive",
};

function WidgetHead({ icon: Icon, title, tint = "accent", right }: { icon: LucideIcon; title: string; tint?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${TINTS[tint]}`}>
        <Icon size={15} strokeWidth={2.2} />
      </span>
      <span className="text-[14px] font-semibold text-ink">{title}</span>
      {right && <span className="ml-auto flex items-center">{right}</span>}
    </div>
  );
}

function FacilityWidget({
  production,
  purchases,
  prodTotal,
  purchTotal,
  counts,
}: {
  production: { code: string; value: number }[];
  purchases: { code: string; value: number }[];
  prodTotal: number;
  purchTotal: number;
  counts: { purchases: number; transactions: number; suppliers: number };
}) {
  return (
    <Card className="flex h-full flex-col">
      <WidgetHead icon={PieChart} title="Value by facility" tint="accent" />
      <div className="grid grid-cols-2 gap-4">
        <FacilityPie data={production} palette={BLUES} label="Production" />
        <FacilityPie data={purchases} palette={VIOLETS} label="Purchases" />
      </div>
      <div className="mt-auto pt-4">
        {/* Only the combined figure: the two halves are already the pies directly above. */}
        <MoneyChip label="Grand total" value={prodTotal + purchTotal} dot="#171717" />
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Mini label="Purchases" value={counts.purchases} />
          <Mini label="Transactions" value={counts.transactions} />
          <Mini label="Suppliers" value={counts.suppliers} />
        </div>
      </div>
    </Card>
  );
}

function MoneyChip({ label, value, dot }: { label: string; value: number; dot: string }) {
  const { money } = useMoney();
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-sm" style={{ background: dot }} />
        <span className="text-[10.5px] text-muted">{label}</span>
      </div>
      <div className="mt-0.5 text-[15px] font-semibold tabular text-ink">{money(value)}</div>
    </div>
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

const SEV: Record<Alert["severity"], { bg: string; dot: string }> = {
  critical: { bg: "#fef2f2", dot: "#dc2626" },
  warn: { bg: "#fff7ed", dot: "#ea580c" },
};
const KIND_ICON: Record<Alert["kind"], LucideIcon> = { material: PackageSearch, reorder: ShoppingCart, expedite: Zap, ship: Truck };

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
      <WidgetHead
        icon={Bell}
        title="Notifications"
        tint={alerts.length ? "red" : "green"}
        right={alerts.length > 0 ? <span className="rounded-full bg-negative px-2 py-0.5 text-[11px] font-semibold text-white">{alerts.length}</span> : null}
      />
      {alerts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted">
          <CheckCircle2 size={26} className="text-positive" />
          <span className="text-[12.5px]">All clear — nothing needs attention</span>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {alerts.map((a) => {
            const s = SEV[a.severity];
            const Icon = KIND_ICON[a.kind];
            return (
              <div key={a.key} className="flex items-start gap-2.5 rounded-lg border-l-[3px] bg-surface-2/60 py-2 pl-2.5 pr-2" style={{ borderColor: s.dot }}>
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: s.bg, color: s.dot }}>
                  <Icon size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-ink">{a.title}</div>
                  <div className="text-[11px] text-muted">{a.detail}</div>
                </div>
                <button onClick={() => dismiss(a.key)} disabled={busy === a.key} title="Dismiss" className="shrink-0 rounded-md p-1 text-muted hover:bg-black/5 hover:text-ink-soft disabled:opacity-40">
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

const TILE_TINTS = {
  amber: { color: "#ea580c", bg: "#fff7ed", border: "#fed7aa" },
  red: { color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
  violet: { color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
} as const;

function MetricTile({ value, label, tint, icon: Icon }: { value: number; label: string; tint: keyof typeof TILE_TINTS; icon: LucideIcon }) {
  const active = value > 0;
  const { color, bg, border } = TILE_TINTS[tint];
  return (
    <div className="rounded-xl border p-3" style={active ? { background: bg, borderColor: border } : { borderColor: "var(--color-border)" }}>
      <div className="flex items-center justify-between">
        <span className="text-[24px] font-semibold leading-none tabular" style={active ? { color } : { color: "var(--color-muted)" }}>{value}</span>
        <Icon size={15} style={{ color: active ? color : "var(--color-muted)" }} />
      </div>
      <div className="mt-1 text-[11px] text-muted">{label}</div>
    </div>
  );
}

function ReorderAlertsWidget({ alerts }: { alerts: Alert[] }) {
  const reorder = alerts.filter((a) => a.kind === "reorder");
  const ship = alerts.filter((a) => a.kind === "ship");
  const expedite = alerts.filter((a) => a.kind === "expedite");
  // Same order as the inventory KPI row, so the two screens read identically.
  const list = [...reorder, ...ship, ...expedite].slice(0, 8);
  return (
    <Card className="flex h-full flex-col">
      <WidgetHead icon={AlertTriangle} title="Reorder alerts" tint="amber" />
      <div className="mb-3 grid grid-cols-3 gap-2.5">
        <MetricTile value={reorder.length} label="Need a PO" tint="amber" icon={FileText} />
        <MetricTile value={ship.length} label="To ship" tint="violet" icon={Truck} />
        <MetricTile value={expedite.length} label="Expedite" tint="red" icon={Zap} />
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
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

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2 py-2 text-center">
      <div className="text-[17px] font-semibold text-ink tabular">{value}</div>
      <div className="text-[10.5px] text-muted">{label}</div>
    </div>
  );
}
