"use client";

import Image from "next/image";
import { Fragment, type ReactNode, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle, Building2, ChevronDown, ChevronRight, DotsVertical, Layers, Search, Settings, Tag, WarehouseFilled, X } from "@/components/icons";
import { SkuAvatar } from "@/components/ui";
import { useMoney } from "@/components/CurrencyProvider";
import { setOrderVoided } from "@/app/(app)/orders/actions";
import type { OrdersSummary, OrdersPage, OrderRow } from "@/lib/order-metrics";
import { inputCls } from "@/components/FormKit";
import { DateRangePicker, type Range } from "@/components/DateRangePicker";
import { HoverHint } from "@/components/HoverHint";
import { useExitAnimation } from "@/components/animate";
import { ROOT_LOGO } from "@/lib/channel-logos";
import { BulkBar, OrderDialog, RulesDialog, type FeeOptions, type DialogMode } from "@/components/OrderFees";
import { paymentMethodLabel } from "@/lib/payment-methods";

// Channel marks come from the shared map — Orders always talks about a whole channel.
const CHANNEL_LOGO = ROOT_LOGO;

const PILL = "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium";

/** The order's lifecycle as a pill. Cancelled wins; platform statuses map to a small shared
 *  vocabulary; anything unrecognized still shows, prettified, as a neutral pill. */
function statusPill(o: OrderRow): { label: string; cls: string } | null {
  if (o.cancelled) return { label: "Cancelled", cls: "pill-red" };
  const s = (o.status ?? "").toLowerCase().replace(/_/g, " ");
  if (!s) return null;
  if (s.includes("pending")) return { label: "Pending", cls: "pill-amber" };
  if (s.includes("unshipped") || s.includes("unfulfilled") || s.includes("awaiting")) return { label: "Unshipped", cls: "pill-amber" };
  if (s.includes("partially") && s.includes("ship")) return { label: "Partially shipped", cls: "pill-amber" };
  if (s === "shipping") return { label: "Shipping", cls: "pill-amber" };
  if (s.includes("shipped") || s.includes("fulfilled") || s.includes("completed") || s.includes("delivered"))
    return { label: "Shipped", cls: "pill-green" };
  if (s.includes("refund")) return { label: "Refunded", cls: "pill-red" };
  if (s.includes("transit")) return { label: "In transit", cls: "pill-amber" };
  if (s.includes("paid")) return { label: "Paid", cls: "pill-green" };
  return { label: s.charAt(0).toUpperCase() + s.slice(1), cls: "pill-neutral" };
}

/** The row's overflow menu (⋮): custom fees, where it shipped from, credits, void/unvoid.
 *  Portalled — the table's scroll container would clip an inline popover. */
function RowMenu({ id, voided, onManage }: { id: string; voided: boolean; onManage: (mode: DialogMode) => void }) {
  const router = useRouter();
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const [pending, start] = useTransition();
  const open = box !== null;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      // The menu lives in a portal, so it is NOT inside btn — exempt both, or a press on a
      // menu item unmounts the menu on mousedown and its click never fires.
      if (!btn.current?.contains(t) && !menu.current?.contains(t)) setBox(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setBox(null);
    const follow = () => setBox(null); // scrolling under a fixed menu — just close it
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", follow, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", follow, true);
    };
  }, [open]);

  function toggle() {
    if (open) return setBox(null);
    const r = btn.current!.getBoundingClientRect();
    setBox({ top: r.bottom + 4, left: Math.max(8, r.right - 172) });
  }

  return (
    <>
      <button
        ref={btn}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Order options"
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
      >
        <DotsVertical size={16} />
      </button>
      {box &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ position: "fixed", top: box.top, left: box.left, width: 172 }}
            className="dropdown-in z-[300] rounded-xl border border-border bg-surface p-1 shadow-xl"
          >
            {(
              [
                ["fees", "Custom fees…"],
                ["shipped", "Shipped from…"],
                ["credits", "Credits…"],
              ] as [DialogMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                role="menuitem"
                onClick={() => {
                  setBox(null);
                  onManage(mode);
                }}
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-soft hover:bg-surface-2 hover:text-ink"
              >
                {label}
              </button>
            ))}
            <button
              role="menuitem"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await setOrderVoided(id, !voided);
                  setBox(null);
                  router.refresh();
                })
              }
              className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-soft hover:bg-surface-2 hover:text-ink disabled:opacity-50"
            >
              {pending ? "Saving…" : voided ? "Unvoid order" : "Void order"}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

const CHANNEL_ORDER = ["AMAZON", "SHOPIFY", "TIKTOK"];
const CHANNEL_NAME: Record<string, string> = { AMAZON: "Amazon", SHOPIFY: "Shopify", TIKTOK: "TikTok" };

/** The Source filter — the platform an order came from (the table's "Source" column) — as a custom
 *  dropdown: each connected platform with its logo, "All sources" on top. Portalled and
 *  exit-animated like the app's other popovers; only platforms actually connected are offered. */
function ChannelSelect({ value, channels, onChange }: { value: string; channels: string[]; onChange: (v: string) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const lastBox = useRef(box);
  if (box) lastBox.current = box;
  const open = box !== null;
  const exit = useExitAnimation(open);

  const options = CHANNEL_ORDER.filter((c) => channels.includes(c));

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (r) setBox({ top: r.bottom + 6, left: r.left });
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setBox(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The list is portalled — exempt it AND the trigger, or an item press unmounts the list
      // on mousedown and its click never fires.
      if (!btn.current?.contains(t) && !panel.current?.contains(t)) setBox(null);
    };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  function toggle() {
    if (open) return setBox(null);
    const r = btn.current!.getBoundingClientRect();
    setBox({ top: r.bottom + 6, left: r.left });
  }

  function choose(v: string) {
    setBox(null);
    if (v !== value) onChange(v);
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-border bg-surface px-3 text-[12.5px] font-medium text-ink outline-none transition-colors hover:border-ink/25 focus-visible:border-ink/40"
      >
        {value && CHANNEL_LOGO[value] ? (
          <Image src={CHANNEL_LOGO[value]} alt="" width={16} height={16} className="rounded-[3px]" />
        ) : (
          <Layers size={15} className="text-ink-soft" />
        )}
        {value ? (CHANNEL_NAME[value] ?? value) : "All sources"}
        <ChevronDown size={13} className="text-muted" />
      </button>
      {exit.mounted &&
        lastBox.current &&
        createPortal(
          <div
            ref={panel}
            role="listbox"
            aria-label="Source"
            style={{ position: "fixed", top: lastBox.current.top, left: lastBox.current.left, width: 190 }}
            className={`${exit.closing ? "dropdown-out" : "dropdown-in"} z-[300] rounded-xl border border-border bg-surface p-1 shadow-xl`}
          >
            {[{ v: "", label: "All sources" }, ...options.map((c) => ({ v: c, label: CHANNEL_NAME[c] ?? c }))].map((o) => {
              const active = value === o.v;
              return (
                <button
                  key={o.v || "all"}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => choose(o.v)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                    active ? "bg-chart-soft font-medium text-chart" : "text-ink-soft hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  {o.v && CHANNEL_LOGO[o.v] ? (
                    <Image src={CHANNEL_LOGO[o.v]} alt="" width={16} height={16} className="rounded-[3px]" />
                  ) : (
                    <Layers size={15} className={active ? undefined : "text-muted"} />
                  )}
                  {o.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

/** A one-of filter as a dropdown — the same popover as the channel filter, no logos: the
 *  "anything" choice on top, then each option with how many orders it holds. Used for "Fulfilled
 *  at" (every facility orders ship from, plus "No facility" when some have none) and for "Tag". */
function OptionSelect({
  value,
  options,
  placeholder,
  ariaLabel,
  icon,
  width = 240,
  onChange,
}: {
  value: string;
  options: { id: string; name: string; orders: number }[];
  placeholder: string;
  ariaLabel: string;
  icon: ReactNode;
  width?: number;
  onChange: (v: string) => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const lastBox = useRef(box);
  if (box) lastBox.current = box;
  const open = box !== null;
  const exit = useExitAnimation(open);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (r) setBox({ top: r.bottom + 6, left: r.left });
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setBox(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !panel.current?.contains(t)) setBox(null);
    };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  function toggle() {
    if (open) return setBox(null);
    const r = btn.current!.getBoundingClientRect();
    setBox({ top: r.bottom + 6, left: r.left });
  }
  function choose(v: string) {
    setBox(null);
    if (v !== value) onChange(v);
  }
  const current = options.find((o) => o.id === value);
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-border bg-surface px-3 text-[12.5px] font-medium text-ink outline-none transition-colors hover:border-ink/25 focus-visible:border-ink/40"
      >
        {icon}
        {current ? current.name : placeholder}
        <ChevronDown size={13} className="text-muted" />
      </button>
      {exit.mounted &&
        lastBox.current &&
        createPortal(
          <div
            ref={panel}
            role="listbox"
            aria-label={ariaLabel}
            style={{ position: "fixed", top: lastBox.current.top, left: lastBox.current.left, width }}
            className={`${exit.closing ? "dropdown-out" : "dropdown-in"} z-[300] rounded-xl border border-border bg-surface p-1 shadow-xl`}
          >
            {[{ id: "", name: placeholder, orders: 0 }, ...options].map((o) => {
              const active = value === o.id;
              return (
                <button
                  key={o.id || "all"}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => choose(o.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                    active ? "bg-chart-soft font-medium text-chart" : "text-ink-soft hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  <span className="truncate">{o.name}</span>
                  {o.id && <span className="shrink-0 text-[11px] tabular text-muted">{o.orders}</span>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

export function OrdersClient({
  summary,
  orders,
  connectedChannels,
  importing = [],
  fees,
  fulfilledOptions,
  tagOptions,
  sourceOptions,
  unplaced,
  filter,
  dataBounds,
}: {
  summary: OrdersSummary;
  orders: OrdersPage;
  /** Connected channels (AMAZON/SHOPIFY/TIKTOK) — the filter offers exactly these; empty = none. */
  connectedChannels: string[];
  /** Channels whose first history pull hasn't finished yet (labels), shown while they fill. */
  importing?: string[];
  /** Fee rules and the vocab the rule form offers. */
  fees: FeeOptions;
  /** Facilities orders are fulfilled from, for the "Fulfilled at" filter. */
  fulfilledOptions: { id: string; name: string; orders: number }[];
  /** The tags orders wear (MCF, Voided, …) with counts, for the "Tag" filter. */
  tagOptions: { id: string; name: string; orders: number }[];
  /** The sales channels orders come through (Online Store, Shop app, TikTok, Faire…) with counts, for the "Sales channel" filter. */
  sourceOptions: { id: string; name: string; orders: number }[];
  /** Orders that count but have no facility yet — the ones a person must place. */
  unplaced: number;
  filter: { channel: string; range: Range; q: string; fulfilledAt: string; tag: string; source: string };
  dataBounds: { newest: string; oldest: string };
}) {
  const connected = connectedChannels.length > 0;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { money, locale } = useMoney();
  const [search, setSearch] = useState(filter.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ id: string; mode: DialogMode } | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  // Rows opened to show their units (per page; a page change starts closed).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The visible width of the scrolling table area: an open order's units table is sized to it, so
  // it spans exactly what is on screen and follows the sideways scroll (see OrderLines).
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [viewW, setViewW] = useState(0);
  useEffect(() => {
    if (!scroller) return;
    const measure = () => setViewW(scroller.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scroller]);
  const toggleOpen = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Only rows on this page count as selected — a page change or filter silently drops the rest.
  const selectedIds = orders.rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected = orders.rows.length > 0 && selectedIds.length === orders.rows.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(orders.rows.map((r) => r.id)));
  const toggleOne = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const dialogOrder = dialog ? orders.rows.find((r) => r.id === dialog.id) ?? null : null;

  /** Update one query param and reset to page 1 (a new filter restarts the walk). */
  function setParam(key: string, value: string) {
    const q = new URLSearchParams(params.toString());
    if (value) q.set(key, value);
    else q.delete(key);
    q.delete("page");
    router.push(`${pathname}?${q.toString()}`);
  }

  /** The time window: a preset key, plus concrete from/to only when custom. */
  function setRange(r: Range) {
    const q = new URLSearchParams(params.toString());
    if (r.key === "all") q.delete("range");
    else q.set("range", r.key);
    if (r.key === "custom") {
      q.set("from", r.from);
      q.set("to", r.to);
    } else {
      q.delete("from");
      q.delete("to");
    }
    q.delete("page");
    router.push(`${pathname}?${q.toString()}`);
  }

  function goToPage(p: number) {
    const q = new URLSearchParams(params.toString());
    q.set("page", String(p));
    router.push(`${pathname}?${q.toString()}`);
  }

  const filtering = !!(filter.channel || filter.source || filter.fulfilledAt || filter.tag || filter.range.key !== "all" || filter.q);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const { page, pageCount, total, pageSize } = orders;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-5">
      {/* Header: totals. No manual import — orders arrive on their own (webhooks, live polls,
          report refreshes) per the always-live rule. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-6">
          <Stat label="Orders" value={summary.totalOrders.toLocaleString()} />
          <Stat label="Units sold" value={summary.totalUnits.toLocaleString()} />
          <Stat label="Revenue" value={money(summary.totalRevenue)} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {importing.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
              Importing your {listOf(importing)} order history in the background — new sales stay live while it fills.
            </span>
          )}
          {/* Orders consl can't place count in no place: Reorder 2.0 leaves them out and the P&L
              prices their units at average cost. One click lists them so they can be selected and
              given a "Fulfilled at". */}
          {unplaced > 0 && (
            <button
              type="button"
              onClick={() => setParam("fulfilled", "none")}
              aria-pressed={filter.fulfilledAt === "none"}
              title="consl can't tell where these orders shipped from, so they count in no place: Reorder 2.0 leaves them out and the P&L prices their units at average cost. Click to list them, select them, then use “Fulfilled at…” to place them."
              className="pill-amber inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium transition-opacity hover:opacity-80"
            >
              <AlertTriangle size={13} />
              {unplaced.toLocaleString()} {unplaced === 1 ? "order has" : "orders have"} no facility · click to fix
            </button>
          )}
          <button
            type="button"
            onClick={() => setRulesOpen((o) => !o)}
            aria-pressed={rulesOpen}
            title="Automatic rules: fees added and orders voided when they match"
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12.5px] font-medium transition-colors ${
              rulesOpen ? "bg-surface-2 text-ink" : "bg-surface text-ink-soft hover:text-ink"
            }`}
          >
            <Settings size={15} />
            Automatic rules
            {fees.rules.length > 0 && <span className="pill-neutral inline-flex items-center rounded-full border px-1.5 py-px text-[10.5px] font-medium">{fees.rules.length}</span>}
          </button>
        </div>
      </div>

      {/* Per-channel split */}
      {summary.channels.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {summary.channels.map((c) => (
            <div key={c.channel} className="rounded-[var(--radius-card)] border border-border bg-surface-2/40 p-4">
              <div className="mb-2 flex items-center gap-2">
                {CHANNEL_LOGO[c.channel] && <Image src={CHANNEL_LOGO[c.channel]} alt="" width={18} height={18} className="rounded-[4px]" />}
                <span className="text-[13px] font-medium text-ink">{c.label}</span>
              </div>
              <div className="text-[19px] font-semibold text-ink">{money(c.revenue)}</div>
              <div className="mt-0.5 text-[12px] text-muted">
                {c.orders.toLocaleString()} orders · {c.units.toLocaleString()} units
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters: the one-of pickers on one row, the search on its own row under them. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker
            value={filter.range}
            onChange={setRange}
            newest={dataBounds.newest}
            oldest={dataBounds.oldest}
            locale={locale}
          />
          <ChannelSelect value={filter.channel} channels={connectedChannels} onChange={(v) => setParam("channel", v)} />
          {sourceOptions.length > 0 && (
            <OptionSelect
              value={filter.source}
              options={sourceOptions}
              placeholder="Any sales channel"
              ariaLabel="Sales channel"
              icon={<Building2 size={15} className="text-ink-soft" />}
              onChange={(v) => setParam("source", v)}
            />
          )}
          {fulfilledOptions.length > 0 && (
            <OptionSelect
              value={filter.fulfilledAt}
              options={fulfilledOptions}
              placeholder="Fulfilled anywhere"
              ariaLabel="Fulfilled at"
              icon={<WarehouseFilled size={15} className="text-ink-soft" />}
              onChange={(v) => setParam("fulfilled", v)}
            />
          )}
          {tagOptions.length > 0 && (
            <OptionSelect
              value={filter.tag}
              options={tagOptions}
              placeholder="Any tag"
              ariaLabel="Tag"
              icon={<Tag size={15} className="text-ink-soft" />}
              width={200}
              onChange={(v) => setParam("tag", v)}
            />
          )}
        </div>
        {/* The search, and — while any filter is on — a Clear button that eases in beside it (the
            search gives way as it grows) and eases back out once everything is cleared. It stays
            mounted so both directions animate; hidden, it is inert and out of the tab order. */}
        <div className="flex items-center">
          <form
            className="relative min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setParam("q", search.trim());
            }}
          >
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => search.trim() !== filter.q && setParam("q", search.trim())}
              placeholder="Search anything — order #, SKU, amount, mcf, pending…"
              className={`${inputCls} pl-8`}
            />
          </form>
          {/* Width eases from nothing to exactly the button's own width: a one-column grid whose
              column animates 0fr → 1fr (the inner box clips while it is narrower). */}
          <div
            aria-hidden={!filtering}
            inert={!filtering}
            className={`grid shrink-0 transition-[grid-template-columns,margin,opacity] duration-300 ease-in-out motion-reduce:transition-none ${
              filtering ? "ml-2 grid-cols-[1fr] opacity-100" : "ml-0 grid-cols-[0fr] opacity-0"
            }`}
          >
            <div className="min-w-0 overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  router.push(pathname);
                }}
                className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent-strong px-3 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
              >
                <X size={13} />
                Clear filters
              </button>
            </div>
          </div>
        </div>
      </div>

      {rulesOpen && <RulesDialog options={fees} onClose={() => setRulesOpen(false)} />}
      {selectedIds.length > 0 && <BulkBar ids={selectedIds} facilities={fees.facilities} onClear={() => setSelected(new Set())} />}

      {/* Orders table */}
      {orders.rows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface-2/40 px-6 py-10 text-center">
          <div className="text-[14px] font-semibold text-ink">No orders found</div>
          <p className="mt-1 text-[12.5px] text-muted">
            {filtering
              ? "Nothing matches these filters."
              : connected
                ? "Your order history is importing itself — check back in a few minutes."
                : "Connect a sales channel to see orders here."}
          </p>
        </div>
      ) : (
        <div>
          <div ref={setScroller} className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
            <table className="w-full min-w-[1100px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-2/50 text-[11px] font-medium uppercase tracking-wide text-muted">
                  <th className="w-9 px-3 py-2.5">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all on this page" className="h-4 w-4 accent-accent-strong" />
                  </th>
                  <th className="w-8 px-1 py-2.5" />
                  <th className="px-3 py-2.5 text-left font-medium">Order</th>
                  <th className="px-4 py-2.5 text-left font-medium">Items</th>
                  <th className="px-4 py-2.5 text-left font-medium">Source</th>
                  <th className="px-4 py-2.5 text-left font-medium">Sales channel</th>
                  <th className="px-4 py-2.5 text-left font-medium">Fulfilled at</th>
                  <th className="px-4 py-2.5 text-left font-medium">Payment</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Units</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {orders.rows.map((o) => {
                  const st = statusPill(o);
                  const open = expanded.has(o.id);
                  const dim = o.cancelled || o.voided || o.excluded ? "opacity-45" : "";
                  return (
                  <Fragment key={o.id}>
                  <tr className={`${open ? "" : "border-b border-line last:border-0"} ${dim} ${selected.has(o.id) ? "bg-accent-soft/40" : ""}`}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleOne(o.id)} aria-label="Select order" className="h-4 w-4 accent-accent-strong" />
                    </td>
                    <td className="px-1 py-2.5">
                      <button
                        type="button"
                        onClick={() => toggleOpen(o.id)}
                        aria-expanded={open}
                        aria-label={open ? "Hide the units in this order" : "Show the units in this order"}
                        title={open ? "Hide units" : "Show units"}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
                      >
                        <ChevronRight size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} />
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-ink">{o.orderNumber ?? "—"}</span>
                        {o.mcf && (
                          <HoverHint title="MCF order" body="Amazon shipped this for another channel (e.g. a Shopify order). The money lives on that channel's own order, so $0 here is correct." className="align-middle">
                            <span className={`${PILL} pill-chart`}>MCF</span>
                          </HoverHint>
                        )}
                        {o.replacement && (
                          <HoverHint title="Replacement" body="A free re-ship of an earlier order — the original order carries the revenue." className="align-middle">
                            <span className={`${PILL} pill-neutral`}>Replacement</span>
                          </HoverHint>
                        )}
                        {o.freeUnit && (
                          <HoverHint title="Free unit" body="A shipped $0 order that isn't MCF or a replacement — could be Vine or another freebie." className="align-middle">
                            <span className={`${PILL} pill-neutral`}>Free unit</span>
                          </HoverHint>
                        )}
                        {o.freeSample && (
                          <HoverHint title="Free sample" body="A TikTok order the buyer paid $0 for — a creator or promo sample." className="align-middle">
                            <span className={`${PILL} pill-neutral`}>Free sample</span>
                          </HoverHint>
                        )}
                        {(o.voided || o.excluded) && (
                          <HoverHint title="Voided" body="Out of every total — a mirrored copy of another channel's sale, an automatic void rule, or voided by hand from the row menu." className="align-middle">
                            <span className={`${PILL} pill-neutral`}>Voided</span>
                          </HoverHint>
                        )}
                      </div>
                      <div className="mt-0.5 whitespace-nowrap text-[11.5px] text-muted">{fmtDate(o.orderedAt)}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <ItemChips lines={o.lines} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        {CHANNEL_LOGO[o.channel] && <Image src={CHANNEL_LOGO[o.channel]} alt="" width={16} height={16} className="shrink-0 rounded-[3px]" />}
                        <span className="text-ink-soft">{o.channelLabel}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">{o.sourceLabel ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-soft">
                      <HoverHint
                        title="Fulfilled at"
                        body={`${o.channelLabel} says "${o.shipFromLabel ? `Merchant · ${o.shipFromLabel}` : (o.fulfillmentLabel ?? "unknown")}"${o.fulfilledAt ? ` — consl places it at ${o.fulfilledAt.name}${o.viaMcf ? " (shipped by Amazon MCF)" : ""}` : o.shipFromLabel ? " — map this ship-from address to a facility under Facilities → Map facilities; until then its units are priced at average cost on the P&L" : " — no facility yet: its units are priced at average cost on the P&L until it ships from a known place or you pick one from the order menu"}.`}
                        className="block"
                      >
                        <span className="flex flex-col leading-tight">
                          {o.fulfilledAtDetected && <span className="text-[11.5px] text-muted line-through">{o.fulfilledAtDetected.name}</span>}
                          <span>
                            {o.fulfilledAt ? o.fulfilledAt.name : <span className="text-muted">No facility</span>}
                            {o.viaMcf && <span className="ml-1 text-[11px] text-muted">via MCF</span>}
                          </span>
                        </span>
                      </HoverHint>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">
                      {o.paymentMethod ? (
                        <span className="flex flex-col leading-tight">
                          <span>{paymentMethodLabel(o.paymentMethod)}</span>
                          {o.paymentDetail && <span className="text-[11px] text-muted">{o.paymentDetail}</span>}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{st ? <span className={`${PILL} ${st.cls}`}>{st.label}</span> : <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink-soft">{o.units.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink-soft">
                      {/* The total, then what consl adds to it — each on its own line, whatever the
                          column's width (the hint's trigger is inline, so a column wrap alone
                          would leave a short "fees" line sitting beside the total). */}
                      <div className="flex flex-col items-end">
                        <span className="whitespace-nowrap">{money(o.total)}</span>
                        {o.fees.length > 0 && (
                          <HoverHint title="Custom fees" body={o.fees.map((f) => `${f.name}: ${money(f.amount)}`).join(" · ")}>
                            <span className="whitespace-nowrap text-[11px] text-muted">−{money(o.feeTotal)} fees</span>
                          </HoverHint>
                        )}
                        {o.credits.length > 0 && (
                          <HoverHint title="Credits" body={o.credits.map((c) => `${c.name}: +${money(c.amount)}`).join(" · ")}>
                            <span className="whitespace-nowrap text-[11px] text-positive">+{money(o.creditTotal)} credits</span>
                          </HoverHint>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <RowMenu id={o.id} voided={o.voided} onManage={(mode) => setDialog({ id: o.id, mode })} />
                    </td>
                  </tr>
                  {open && (
                    <tr className={`border-b border-line last:border-0 ${dim}`}>
                      {/* One cell across the whole row: the block inside is sized to the visible width and
                          sticks to the left, so it never pushes the table wider. */}
                      <td colSpan={12} className="px-3 pb-3 pt-0.5">
                        <OrderLines lines={o.lines} money={money} width={viewW} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pager */}
          <div className="mt-3 flex items-center justify-between text-[12.5px] text-muted">
            <span>
              {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-medium text-ink-soft hover:text-ink disabled:opacity-40"
              >
                <ChevronRight size={14} className="rotate-180" /> Prev
              </button>
              <span className="px-1 tabular">
                {page} / {pageCount}
              </span>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= pageCount}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-medium text-ink-soft hover:text-ink disabled:opacity-40"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {dialogOrder && dialog && <OrderDialog order={dialogOrder} mode={dialog.mode} facilities={fees.facilities} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** The units in an order at a glance — each product's picture and code, ×qty when more than one
 *  (the first four; the rest is a count). An unmapped SKU shows as sold, in grey. */
function ItemChips({ lines }: { lines: OrderRow["lines"] }) {
  if (lines.length === 0) return <span className="text-muted">—</span>;
  const shown = lines.slice(0, 4);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((l, i) => {
        const code = l.code ?? l.sku ?? "?";
        return (
          <span key={i} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface py-0.5 pl-0.5 pr-1.5" title={`${l.name ?? l.sku ?? code} × ${l.quantity}`}>
            <SkuAvatar code={code} imageUrl={l.imageUrl} size={20} />
            <span className={`max-w-[96px] truncate text-[11px] font-medium ${l.code ? "text-ink" : "text-muted"}`}>{code}</span>
            {l.quantity > 1 && <span className="text-[10.5px] tabular text-muted">×{l.quantity}</span>}
          </span>
        );
      })}
      {lines.length > shown.length && <span className="text-[11px] text-muted">+{lines.length - shown.length}</span>}
    </div>
  );
}

/** The opened row: every unit on the order with the product it maps to (or the SKU as sold, when
 *  unmapped), its quantity and its net price.
 *
 *  Spans the full VISIBLE width of the orders table (measured by the parent) and is sticky on the
 *  left: the table is wider than the screen and scrolls sideways, so a block anchored at the
 *  table's left edge would sit off-screen for anyone looking at the Total column — this one is
 *  always exactly what is on screen, wherever the table is scrolled. Fixed column widths for the
 *  SKU and the numbers; the Item column takes the rest, a long product name cut to one line (the
 *  full name is the tooltip). */
function OrderLines({ lines, money, width }: { lines: OrderRow["lines"]; money: (v: number) => string; width: number }) {
  if (lines.length === 0) return <div className="text-[12px] text-muted">No line items on this order.</div>;
  return (
    <div className="sticky left-3 min-w-[640px] overflow-hidden rounded-lg border border-border bg-surface" style={width > 0 ? { width: width - 24 } : undefined}>
      <table className="w-full table-fixed border-collapse text-[12.5px]">
        <colgroup>
          <col />
          <col className="w-[200px]" />
          <col className="w-[76px]" />
          <col className="w-[110px]" />
          <col className="w-[116px]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line bg-surface-2/50 text-[10.5px] font-medium uppercase tracking-wide text-muted">
            <th className="whitespace-nowrap px-3 py-1.5 text-left font-medium">Item</th>
            <th className="whitespace-nowrap px-3 py-1.5 text-left font-medium">SKU as sold</th>
            <th className="whitespace-nowrap px-3 py-1.5 text-right font-medium">Units</th>
            <th className="whitespace-nowrap px-3 py-1.5 text-right font-medium">Unit price</th>
            <th className="whitespace-nowrap px-3 py-1.5 text-right font-medium">Line total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              <td className="overflow-hidden px-3 py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <SkuAvatar code={l.code ?? l.sku ?? "?"} imageUrl={l.imageUrl} size={24} />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate font-medium text-ink">{l.code ?? <span className="font-normal text-muted">Not mapped to a product</span>}</span>
                    {l.name && <span className="truncate text-[11px] text-muted" title={l.name}>{l.name}</span>}
                  </span>
                </span>
              </td>
              <td className="truncate px-3 py-1.5 text-ink-soft" title={l.sku ?? undefined}>{l.sku ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right tabular text-ink-soft">{l.quantity.toLocaleString()}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right tabular text-ink-soft">{money(l.unitPrice)}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right tabular text-ink">{money(l.unitPrice * l.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">Product prices are net of promotions. Shipping, tax and order-level discounts sit in the order total.</div>
    </div>
  );
}

/** "Shopify", "Shopify and TikTok", "Amazon, Shopify and TikTok". */
function listOf(xs: string[]): string {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold tabular text-ink">{value}</div>
    </div>
  );
}
