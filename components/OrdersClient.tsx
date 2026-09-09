"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, DotsVertical, Layers, Search, Settings } from "@/components/icons";
import { useMoney } from "@/components/CurrencyProvider";
import { setOrderVoided } from "@/app/orders/actions";
import type { OrdersSummary, OrdersPage, OrderRow } from "@/lib/order-metrics";
import { inputCls } from "@/components/FormKit";
import { DateRangePicker, type Range } from "@/components/DateRangePicker";
import { HoverHint } from "@/components/HoverHint";
import { useExitAnimation } from "@/components/animate";
import { ROOT_LOGO } from "@/lib/channel-logos";
import { BulkBar, OrderDialog, FeeRulesPanel, type FeeOptions } from "@/components/OrderFees";

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

/** The row's overflow menu (⋮): void/unvoid today, more settings later. Portalled — the table's
 *  scroll container would clip an inline popover. */
function RowMenu({ id, voided, onManage }: { id: string; voided: boolean; onManage: () => void }) {
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
    setBox({ top: r.bottom + 4, left: Math.max(8, r.right - 160) });
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
            style={{ position: "fixed", top: box.top, left: box.left, width: 160 }}
            className="dropdown-in z-[300] rounded-xl border border-border bg-surface p-1 shadow-xl"
          >
            <button
              role="menuitem"
              onClick={() => {
                setBox(null);
                onManage();
              }}
              className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-soft hover:bg-surface-2 hover:text-ink"
            >
              Fees &amp; fulfillment…
            </button>
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

/** The channel filter as a custom dropdown — each connected channel with its logo, "All channels"
 *  on top. Portalled and exit-animated like the app's other popovers; only channels actually
 *  connected are offered. */
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
        {value ? (CHANNEL_NAME[value] ?? value) : "All channels"}
        <ChevronDown size={13} className="text-muted" />
      </button>
      {exit.mounted &&
        lastBox.current &&
        createPortal(
          <div
            ref={panel}
            role="listbox"
            aria-label="Sales channel"
            style={{ position: "fixed", top: lastBox.current.top, left: lastBox.current.left, width: 190 }}
            className={`${exit.closing ? "dropdown-out" : "dropdown-in"} z-[300] rounded-xl border border-border bg-surface p-1 shadow-xl`}
          >
            {[{ v: "", label: "All channels" }, ...options.map((c) => ({ v: c, label: CHANNEL_NAME[c] ?? c }))].map((o) => {
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

export function OrdersClient({
  summary,
  orders,
  connectedChannels,
  historyImporting = false,
  fees,
  filter,
  dataBounds,
}: {
  summary: OrdersSummary;
  orders: OrdersPage;
  /** Connected channels (AMAZON/SHOPIFY/TIKTOK) — the filter offers exactly these; empty = none. */
  connectedChannels: string[];
  /** The background history walk hasn't finished its verification pass yet. */
  historyImporting?: boolean;
  /** Fee rules and the vocab the rule form offers. */
  fees: FeeOptions;
  filter: { channel: string; range: Range; q: string };
  dataBounds: { newest: string; oldest: string };
}) {
  const connected = connectedChannels.length > 0;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { money, locale } = useMoney();
  const [search, setSearch] = useState(filter.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogId, setDialogId] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
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
  const dialogOrder = dialogId ? orders.rows.find((r) => r.id === dialogId) ?? null : null;

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
        {historyImporting && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
            Importing your order history in the background — new sales stay live while it fills.
          </span>
        )}
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

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker
          value={filter.range}
          onChange={setRange}
          newest={dataBounds.newest}
          oldest={dataBounds.oldest}
          locale={locale}
        />
        <ChannelSelect value={filter.channel} channels={connectedChannels} onChange={(v) => setParam("channel", v)} />
        <form
          className="relative min-w-[220px] flex-1 sm:max-w-[280px]"
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
        {(filter.channel || filter.range.key !== "all" || filter.q) && (
          <button
            onClick={() => router.push(pathname)}
            className="text-[12.5px] font-medium text-muted underline-offset-2 hover:text-ink-soft hover:underline"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={() => setRulesOpen((o) => !o)}
          aria-pressed={rulesOpen}
          title="Fee rules"
          className={`ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12.5px] font-medium transition-colors ${
            rulesOpen ? "bg-surface-2 text-ink" : "bg-surface text-ink-soft hover:text-ink"
          }`}
        >
          <Settings size={15} />
          Fee rules
          {fees.rules.length > 0 && <span className="pill-neutral inline-flex items-center rounded-full border px-1.5 py-px text-[10.5px] font-medium">{fees.rules.length}</span>}
        </button>
      </div>

      {rulesOpen && <FeeRulesPanel options={fees} onClose={() => setRulesOpen(false)} />}
      {selectedIds.length > 0 && <BulkBar ids={selectedIds} onClear={() => setSelected(new Set())} />}

      {/* Orders table */}
      {orders.rows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface-2/40 px-6 py-10 text-center">
          <div className="text-[14px] font-semibold text-ink">No orders found</div>
          <p className="mt-1 text-[12.5px] text-muted">
            {filter.channel || filter.range.key !== "all" || filter.q
              ? "Nothing matches these filters."
              : connected
                ? "Your order history is importing itself — check back in a few minutes."
                : "Connect a sales channel to see orders here."}
          </p>
        </div>
      ) : (
        <div>
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
            <table className="w-full min-w-[900px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-2/50 text-[11px] font-medium uppercase tracking-wide text-muted">
                  <th className="w-9 px-3 py-2.5">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all on this page" className="h-4 w-4 accent-accent-strong" />
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">Date</th>
                  <th className="px-4 py-2.5 text-left font-medium">Order #</th>
                  <th className="px-4 py-2.5 text-left font-medium">Source</th>
                  <th className="px-4 py-2.5 text-left font-medium">Sales channel</th>
                  <th className="px-4 py-2.5 text-left font-medium">Fulfilled at</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Units</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {orders.rows.map((o) => {
                  const st = statusPill(o);
                  return (
                  <tr key={o.id} className={`border-b border-line last:border-0 ${o.cancelled || o.voided || o.excluded ? "opacity-45" : ""} ${selected.has(o.id) ? "bg-accent-soft/40" : ""}`}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleOne(o.id)} aria-label="Select order" className="h-4 w-4 accent-accent-strong" />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[12px] text-muted">{fmtDate(o.orderedAt)}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-ink">{o.orderNumber ?? "—"}</span>

                      {o.mcf && (
                        <HoverHint
                          title="MCF order"
                          body="Amazon shipped this for another channel (e.g. a Shopify order). The money lives on that channel's own order, so $0 here is correct."
                          className="ml-2 align-middle"
                        >
                          <span className={`${PILL} pill-chart`}>MCF</span>
                        </HoverHint>
                      )}
                      {o.replacement && (
                        <HoverHint
                          title="Replacement"
                          body="A free re-ship of an earlier order — the original order carries the revenue."
                          className="ml-2 align-middle"
                        >
                          <span className={`${PILL} pill-neutral`}>Replacement</span>
                        </HoverHint>
                      )}
                      {o.freeUnit && (
                        <HoverHint
                          title="Free unit"
                          body="A shipped $0 order that isn't MCF or a replacement — could be Vine or another freebie."
                          className="ml-2 align-middle"
                        >
                          <span className={`${PILL} pill-neutral`}>Free unit</span>
                        </HoverHint>
                      )}
                      {o.freeSample && (
                        <HoverHint
                          title="Free sample"
                          body="A TikTok order the buyer paid $0 for — a creator or promo sample."
                          className="ml-2 align-middle"
                        >
                          <span className={`${PILL} pill-neutral`}>Free sample</span>
                        </HoverHint>
                      )}
                      {(o.voided || o.excluded) && (
                        <HoverHint
                          title="Voided"
                          body="Out of every total — a double-count removed by an exclusion toggle, or voided by hand from the row menu."
                          className="ml-2 align-middle"
                        >
                          <span className={`${PILL} pill-neutral`}>Voided</span>
                        </HoverHint>
                      )}
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
                        body={`${o.channelLabel} says "${o.fulfillmentLabel ?? "unknown"}"${o.fulfilledAt ? ` — consl places it at ${o.fulfilledAt.name}${o.viaMcf ? " (shipped by Amazon MCF)" : ""}` : " — not placed at a facility yet"}.`}
                        className="block"
                      >
                        <span className="flex flex-col leading-tight">
                          {o.fulfilledAtDetected && <span className="text-[11.5px] text-muted line-through">{o.fulfilledAtDetected.name}</span>}
                          <span>
                            {o.fulfilledAt?.name ?? o.fulfillmentLabel ?? "—"}
                            {o.viaMcf && <span className="ml-1 text-[11px] text-muted">via MCF</span>}
                          </span>
                        </span>
                      </HoverHint>
                    </td>
                    <td className="px-4 py-2.5">{st ? <span className={`${PILL} ${st.cls}`}>{st.label}</span> : <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink-soft">{o.units.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink-soft">
                      {money(o.total)}
                      {o.fees.length > 0 && (
                        <HoverHint
                          title="Custom fees"
                          body={o.fees.map((f) => `${f.name}: ${money(f.amount)}`).join(" · ")}
                          className="block"
                        >
                          <span className="block text-[11px] text-muted">−{money(o.feeTotal)} fees</span>
                        </HoverHint>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <RowMenu id={o.id} voided={o.voided} onManage={() => setDialogId(o.id)} />
                    </td>
                  </tr>
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

      {dialogOrder && <OrderDialog order={dialogOrder} facilities={fees.facilities} onClose={() => setDialogId(null)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold tabular text-ink">{value}</div>
    </div>
  );
}
