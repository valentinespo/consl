"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X, Plus, Check, ChevronDown, Receipt, CurrencyDollar, Truck, Prohibit } from "@/components/icons";
import { inputCls } from "@/components/FormKit";
import { SelectMenu } from "@/components/SelectMenu";
import { DateRangePicker, type Range } from "@/components/DateRangePicker";
import { DatePicker } from "@/components/DatePicker";
import { rangeBounds } from "@/lib/chart";
import { useMoney } from "@/components/CurrencyProvider";
import { paymentMethodLabel } from "@/lib/payment-methods";
import {
  addOrderFees,
  addOrderCredits,
  removeOrderFee,
  setFulfillmentOverride,
  setFulfillmentOverrides,
  setOrdersVoided,
  setOrdersRevenueVoided,
  setOrdersCogsVoided,
  setOrderVoided,
  setOrderRevenueVoided,
  setOrderCogsVoided,
  createFeeRule,
  deleteFeeRule,
  setFeeRuleActive,
} from "@/app/(app)/orders/actions";
import type { OrderRow, FeeRuleRow, FeeRuleOptions } from "@/lib/order-metrics";

/**
 * Changing orders: the bulk bar over a selection, each order's Adjustments (inside its opened row:
 * custom fees, credits, where it shipped from, a void), and the automatic-rules panel behind the
 * Orders tab's gear. All writes go through the server actions and refresh the page; nothing is
 * kept locally beyond the form drafts.
 */

export type FeeOptions = FeeRuleOptions;

// Client-side copy of the rule vocabulary (the server module can't be imported here).
const FEE_TAGS: Record<string, string> = { mcf: "MCF", free_sample: "Free sample", replacement: "Replacement", free_unit: "Free unit" };
type VoidKind = "all" | "revenue" | "cogs";
/** What a void rule takes out: its choices, what each does (the rule list's line), and the note under the form. */
const VOID_KIND: Record<VoidKind, { label: string; does: string; note: string }> = {
  all: {
    label: "The whole order",
    does: "Voids every matching order",
    note: "Matching orders are voided: out of sales, units, velocity and the P&L, with the Voided pill on the row.",
  },
  revenue: {
    label: "Revenue only",
    does: "Voids the revenue of every matching order",
    note: "Matching orders keep their units' cost of goods, but their money (sales, fees, refunds) is left out of the P&L, with the Revenue voided pill on the row.",
  },
  cogs: {
    label: "Cost of goods only",
    does: "Voids the cost of goods of every matching order",
    note: "Matching orders keep their money, but their units' cost of goods is left out, with the COGS voided pill on the row. For orders whose units are already costed another way, like an Amazon removal order.",
  },
};
const CHANNEL_NAME: Record<string, string> = { AMAZON: "Amazon", SHOPIFY: "Shopify", TIKTOK: "TikTok" };

const btnPrimary = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-strong px-3 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnSecondary = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12.5px] font-medium text-ink-soft hover:text-ink disabled:opacity-50";
const iconBtn = "inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink";

type Result = { ok: boolean; error?: string };
type Bucket = "custom_fees" | "payment_fees";
type FeeDraft = { name: string; kind: "fixed" | "percent"; value: string; extra: string; bucket: Bucket };
const emptyFee: FeeDraft = { name: "", kind: "fixed", value: "", extra: "", bucket: "custom_fees" };
type CreditBucket = "sales" | "custom_fees" | "payment_fees";
type CreditDraft = { name: string; kind: "fixed" | "percent"; value: string; bucket: CreditBucket };
const emptyCredit: CreditDraft = { name: "", kind: "fixed", value: "", bucket: "sales" };
const num = (s: string) => Number(s.replace(",", "."));
const parseFee = (d: FeeDraft) => ({
  name: d.name.trim(),
  kind: d.kind,
  value: num(d.value),
  extraFixed: d.kind === "percent" && d.extra.trim() ? num(d.extra) : null,
  bucket: d.bucket,
});

const parseCredit = (d: CreditDraft) => ({ name: d.name.trim(), kind: d.kind, value: num(d.value), bucket: d.bucket });

/** "Processing fee", "Chargeback fee" — a ledger type as words. */
const spell = (t: string) => t.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^\w/, (c) => c.toUpperCase());

/** Name + type + amount (+ a flat amount on top of a percentage) + the P&L bucket — shared by the
 *  bulk bar, the order dialog and the rule form. */
function FeeFields({ draft, onChange }: { draft: FeeDraft; onChange: (d: FeeDraft) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_170px_110px]">
        <input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="Fee name, e.g. Faire commission"
          className={inputCls}
          maxLength={60}
        />
        <SelectMenu
          value={draft.kind}
          onChange={(v) => onChange({ ...draft, kind: v as FeeDraft["kind"] })}
          options={[
            { value: "fixed", label: "Fixed amount" },
            { value: "percent", label: "% of amount paid" },
          ]}
        />
        <div className="relative">
          <input
            value={draft.value}
            onChange={(e) => onChange({ ...draft, value: e.target.value })}
            inputMode="decimal"
            placeholder={draft.kind === "percent" ? "15" : "2.50"}
            className={`${inputCls} ${draft.kind === "percent" ? "pr-7" : ""}`}
          />
          {draft.kind === "percent" && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-muted">%</span>}
        </div>
      </div>
      {/* The bucket takes the whole row; a percentage's flat amount on top shares it. */}
      <div className={`grid gap-2 ${draft.kind === "percent" ? "sm:grid-cols-2" : ""}`}>
        <SelectMenu
          value={draft.bucket}
          onChange={(v) => onChange({ ...draft, bucket: v as Bucket })}
          options={[
            { value: "custom_fees", label: "Shows on the P&L under Custom fees" },
            { value: "payment_fees", label: "Shows on the P&L under Payment processing" },
          ]}
        />
        {draft.kind === "percent" && (
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-muted">+</span>
            <input
              value={draft.extra}
              onChange={(e) => onChange({ ...draft, extra: e.target.value })}
              inputMode="decimal"
              placeholder="flat amount per order on top, e.g. 0.49 (optional)"
              className={`${inputCls} pl-7`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Name + type + amount + where it lands on the P&L — for money ADDED to an order. */
function CreditFields({ draft, onChange }: { draft: CreditDraft; onChange: (d: CreditDraft) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_170px_110px]">
        <input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="Credit name, e.g. Shipping charged to the customer"
          className={inputCls}
          maxLength={60}
        />
        <SelectMenu
          value={draft.kind}
          onChange={(v) => onChange({ ...draft, kind: v as CreditDraft["kind"] })}
          options={[
            { value: "fixed", label: "Fixed amount" },
            { value: "percent", label: "% of amount paid" },
          ]}
        />
        <div className="relative">
          <input
            value={draft.value}
            onChange={(e) => onChange({ ...draft, value: e.target.value })}
            inputMode="decimal"
            placeholder={draft.kind === "percent" ? "5" : "12.37"}
            className={`${inputCls} ${draft.kind === "percent" ? "pr-7" : ""}`}
          />
          {draft.kind === "percent" && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-muted">%</span>}
        </div>
      </div>
      <SelectMenu
        value={draft.bucket}
        onChange={(v) => onChange({ ...draft, bucket: v as CreditBucket })}
        options={[
          { value: "sales", label: "Counts as revenue — on the P&L under Sales" },
          { value: "custom_fees", label: "Nets against Custom fees on the P&L" },
          { value: "payment_fees", label: "Nets against Payment processing on the P&L" },
        ]}
      />
    </div>
  );
}

/** Actions over the ticked rows: void (whole order, revenue only or cost of goods only), unvoid,
 *  put the same fee or credit on each, or set where they shipped from. */
export function BulkBar({ ids, facilities, onClear }: { ids: string[]; facilities: { id: string; name: string }[]; onClear: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [feeOpen, setFeeOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [place, setPlace] = useState("");
  const [draft, setDraft] = useState<FeeDraft>(emptyFee);
  const [credit, setCredit] = useState<CreditDraft>(emptyCredit);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      setError(null);
      setFeeOpen(false);
      setCreditOpen(false);
      setPlaceOpen(false);
      setDraft(emptyFee);
      setCredit(emptyCredit);
      onClear();
      router.refresh();
    });
  return (
    <div className="dropdown-in flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-accent-strong/40 bg-accent-soft/60 px-3 py-2 text-[12.5px]">
      <span className="font-medium text-ink">
        {ids.length} selected
      </span>
      <button className={btnSecondary} disabled={pending} onClick={() => run(() => setOrdersVoided(ids, true))}>
        Void
      </button>
      <button className={btnSecondary} disabled={pending} onClick={() => run(() => setOrdersRevenueVoided(ids, true))}>
        Void revenue
      </button>
      <button className={btnSecondary} disabled={pending} onClick={() => run(() => setOrdersCogsVoided(ids, true))}>
        Void cost of goods
      </button>
      <button className={btnSecondary} disabled={pending} onClick={() => run(() => setOrdersVoided(ids, false))}>
        Unvoid
      </button>
      <button className={btnSecondary} disabled={pending} onClick={() => { setFeeOpen((o) => !o); setCreditOpen(false); setPlaceOpen(false); }}>
        <Plus size={13} /> Add fee
      </button>
      <button className={btnSecondary} disabled={pending} onClick={() => { setCreditOpen((o) => !o); setFeeOpen(false); setPlaceOpen(false); }}>
        <Plus size={13} /> Add credit
      </button>
      <button className={btnSecondary} disabled={pending} onClick={() => { setPlaceOpen((o) => !o); setFeeOpen(false); setCreditOpen(false); }}>
        Shipped from…
      </button>
      {error && <span className="text-[12px] text-negative">{error}</span>}
      <button className="ml-auto text-[12px] text-muted hover:text-ink" onClick={onClear}>
        Clear selection
      </button>
      {placeOpen && (
        <div className="basis-full">
          <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
            <div className="min-w-[240px] flex-1">
              <SelectMenu value={place} onChange={setPlace} options={[{ value: "", label: "Back to what consl detected" }, ...facilities.map((f) => ({ value: f.id, label: f.name }))]} />
            </div>
            <button className={btnPrimary} disabled={pending} onClick={() => run(() => setFulfillmentOverrides(ids, place || null))}>
              <Check size={13} /> {pending ? "Saving…" : `Set on ${ids.length} order${ids.length === 1 ? "" : "s"}`}
            </button>
            <button className={btnSecondary} onClick={() => setPlaceOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {feeOpen && (
        <div className="basis-full">
          <div className="mt-1 flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <FeeFields draft={draft} onChange={setDraft} />
            <div className="flex items-center gap-2">
              <button className={btnPrimary} disabled={pending} onClick={() => run(() => addOrderFees(ids, parseFee(draft)))}>
                <Check size={13} /> {pending ? "Adding…" : `Add to ${ids.length} order${ids.length === 1 ? "" : "s"}`}
              </button>
              <button className={btnSecondary} onClick={() => setFeeOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {creditOpen && (
        <div className="basis-full">
          <div className="mt-1 flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <CreditFields draft={credit} onChange={setCredit} />
            <div className="flex items-center gap-2">
              <button className={btnPrimary} disabled={pending} onClick={() => run(() => addOrderCredits(ids, parseCredit(credit)))}>
                <Check size={13} /> {pending ? "Adding…" : `Add to ${ids.length} order${ids.length === 1 ? "" : "s"}`}
              </button>
              <button className={btnSecondary} onClick={() => setCreditOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type AddKind = "fee" | "credit" | "shipped";
const CREDIT_PLACE: Record<CreditBucket, string> = { sales: "credit to Sales", custom_fees: "credit against Custom fees", payment_fees: "credit against Payment processing" };
const VOID_ROW: Record<VoidKind, { pill: string; note: string; menu: string }> = {
  all: { pill: "Voided", note: "out of every total", menu: "Void the whole order" },
  revenue: { pill: "Revenue voided", note: "its money isn't counted, its units' cost is", menu: "Void revenue only" },
  cogs: { pill: "COGS voided", note: "its money counts, its units' cost doesn't", menu: "Void cost of goods only" },
};

/** One adjustment: what it is, then its amount and what you can do with it. */
function AdjustmentRow({ icon, children, amount, actions }: { icon?: ReactNode; children: ReactNode; amount?: ReactNode; actions?: ReactNode }) {
  return (
    <li className="flex min-h-[38px] items-center justify-between gap-3 px-3 py-1.5 text-[12.5px]">
      <span className="flex min-w-0 items-center gap-2">
        {icon && <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-soft">{icon}</span>}
        <span className="min-w-0 truncate text-ink">{children}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {amount}
        {actions}
      </span>
    </li>
  );
}

/** "+ Add adjustment": a small menu, portalled so the orders table's scroll box can't clip it. */
function AddAdjustmentMenu({ voidKind, disabled, onAdd, onVoid }: { voidKind: VoidKind | null; disabled: boolean; onAdd: (k: AddKind) => void; onVoid: (k: VoidKind) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!box) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !menu.current?.contains(t)) setBox(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setBox(null);
    const follow = () => setBox(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", follow, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", follow, true);
    };
  }, [box]);
  const item = "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-soft hover:bg-surface-2 hover:text-ink disabled:opacity-50";
  const glyph = "shrink-0 text-muted";
  const pick = (fn: () => void) => () => {
    setBox(null);
    fn();
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={!!box}
        onClick={() => {
          if (box) return setBox(null);
          const r = btn.current!.getBoundingClientRect();
          setBox({ top: r.bottom + 4, left: Math.max(8, r.right - 220) });
        }}
        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-medium text-ink-soft hover:border-ink/25 hover:text-ink disabled:opacity-50"
      >
        <Plus size={12} /> Add adjustment <ChevronDown size={12} className="text-muted" />
      </button>
      {box &&
        createPortal(
          <div ref={menu} role="menu" style={{ position: "fixed", top: box.top, left: box.left, width: 220 }} className="dropdown-in z-[300] rounded-xl border border-border bg-surface p-1 shadow-xl">
            <button role="menuitem" className={item} onClick={pick(() => onAdd("fee"))}>
              <Receipt size={14} className={glyph} /> Fee
            </button>
            <button role="menuitem" className={item} onClick={pick(() => onAdd("credit"))}>
              <CurrencyDollar size={14} className={glyph} /> Credit
            </button>
            <button role="menuitem" className={item} onClick={pick(() => onAdd("shipped"))}>
              <Truck size={14} className={glyph} /> Shipped from
            </button>
            <div className="my-1 border-t border-line" />
            {(Object.keys(VOID_ROW) as VoidKind[]).map((k) => (
              <button key={k} role="menuitem" className={item} disabled={voidKind === k} onClick={pick(() => onVoid(k))}>
                <Prohibit size={14} className={glyph} />
                <span className="flex-1">{VOID_ROW[k].menu}</span>
                {voidKind === k && <Check size={13} className="text-accent" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Everything changed on one order, inside its opened row: each custom fee, each credit, where it
 * shipped from, and a void — one row each, removed or undone on the spot — and "Add adjustment"
 * to put on another (a fee, a credit, where it shipped from, or one of the three voids).
 */
export function OrderAdjustments({ order, facilities }: { order: OrderRow; facilities: { id: string; name: string }[] }) {
  const router = useRouter();
  const { money } = useMoney();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState<AddKind | null>(null);
  const [draft, setDraft] = useState<FeeDraft>(emptyFee);
  const [credit, setCredit] = useState<CreditDraft>(emptyCredit);
  const [loc, setLoc] = useState(order.shippedFromChanged ? (order.fulfilledAt?.id ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const channelName = CHANNEL_NAME[order.channel] ?? order.channel;
  const detected = order.shippedFromChanged ? order.fulfilledAtDetected : order.fulfilledAt;
  const voidKind: VoidKind | null = order.voided ? "all" : order.revenueVoided ? "revenue" : order.cogsVoided ? "cogs" : null;

  const act = (fn: () => Promise<Result>, done?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      setError(null);
      done?.();
      router.refresh();
    });
  const voidAs = (kind: VoidKind | null) =>
    act(() =>
      kind === "all"
        ? setOrderVoided(order.id, true)
        : kind === "revenue"
          ? setOrderRevenueVoided(order.id, true)
          : kind === "cogs"
            ? setOrderCogsVoided(order.id, true)
            : setOrderVoided(order.id, false),
    );
  const close = () => {
    setAdding(null);
    setDraft(emptyFee);
    setCredit(emptyCredit);
    setError(null);
  };
  const remove = (label: string, fn: () => Promise<Result>) => (
    <button className={iconBtn} disabled={pending} onClick={() => act(fn)} aria-label={label} title={label}>
      <X size={13} />
    </button>
  );
  const locations = [
    { value: "", label: detected ? `As ${channelName} said (${detected.name})` : "As detected (no facility yet)" },
    ...facilities.filter((f) => f.id !== detected?.id).map((f) => ({ value: f.id, label: f.name })),
  ];

  const rows: ReactNode[] = [
    ...order.fees.map((f) => (
      <AdjustmentRow
        key={f.id}
        icon={<Receipt size={13} />}
        amount={<span className="tabular text-ink-soft">−{money(f.amount)}</span>}
        actions={f.fromRule ? <span className="w-7" /> : remove("Remove fee", () => removeOrderFee(f.id))}
      >
        {f.name}
        <span className="text-muted"> · {f.bucket === "payment_fees" ? "Payment processing" : "Custom fees"}</span>
        {f.fromRule && <span className="pill-neutral ml-2 inline-flex items-center rounded-full border px-1.5 py-px text-[10.5px] font-medium">from a rule</span>}
      </AdjustmentRow>
    )),
    ...order.credits.map((c) => (
      <AdjustmentRow key={c.id} icon={<CurrencyDollar size={13} />} amount={<span className="tabular text-positive">+{money(c.amount)}</span>} actions={remove("Remove credit", () => removeOrderFee(c.id))}>
        {c.name}
        <span className="text-muted"> · {CREDIT_PLACE[c.bucket as CreditBucket] ?? c.bucket}</span>
      </AdjustmentRow>
    )),
    ...(order.shippedFromChanged
      ? [
          <AdjustmentRow
            key="shipped"
            icon={<Truck size={13} />}
            actions={
              <>
                <button className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-2 hover:text-ink" disabled={pending} onClick={() => setAdding("shipped")}>
                  Change
                </button>
                {remove("Back to what the channel said", () => setFulfillmentOverride(order.id, null))}
              </>
            }
          >
            Shipped from {order.fulfilledAt?.name ?? "—"}
            <span className="text-muted"> · {channelName} said {detected?.name ?? `“${order.fulfillmentLabel ?? "unknown"}”`}</span>
          </AdjustmentRow>,
        ]
      : []),
    ...(voidKind
      ? [
          <AdjustmentRow
            key="void"
            icon={<Prohibit size={13} />}
            actions={
              <button className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-2 hover:text-ink" disabled={pending} onClick={() => voidAs(null)}>
                Undo
              </button>
            }
          >
            <span className="pill-red inline-flex items-center rounded-full border px-2 py-px text-[11px] font-medium">{VOID_ROW[voidKind].pill}</span>
            <span className="ml-2 text-muted">{VOID_ROW[voidKind].note}</span>
          </AdjustmentRow>,
        ]
      : order.excluded
        ? [
            <AdjustmentRow key="excluded" icon={<Prohibit size={13} />}>
              <span className="pill-red inline-flex items-center rounded-full border px-2 py-px text-[11px] font-medium">Voided</span>
              <span className="ml-2 text-muted">left out automatically: a copy of another channel&apos;s sale</span>
            </AdjustmentRow>,
          ]
        : []),
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/50 px-3 py-1.5">
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted">Adjustments</span>
        <AddAdjustmentMenu voidKind={voidKind} disabled={pending} onAdd={(k) => { setError(null); setAdding(k); }} onVoid={(k) => voidAs(k)} />
      </div>
      {rows.length > 0 ? (
        <ul className="divide-y divide-line">{rows}</ul>
      ) : (
        !adding && <p className="px-3 py-2.5 text-[12px] text-muted">Nothing changed on this order. Add a fee, a credit, where it shipped from, or a void.</p>
      )}

      {adding && (
        <div className="flex flex-col gap-2 border-t border-line bg-surface-2/30 p-3">
          {adding === "fee" && (
            <>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">New fee</div>
              {order.channel !== "AMAZON" && (
                <p className="text-[12px] text-muted">
                  {order.platformFees.length
                    ? `${channelName} already reported: ${order.platformFees.map((f) => `${spell(f.name)} ${f.amount < 0 ? `−${money(-f.amount)}` : money(f.amount)}`).join(", ")}.`
                    : `${channelName} reported no processing fee for this order${order.paymentMethod ? ` (paid with ${paymentMethodLabel(order.paymentMethod)})` : ""}.`}
                </p>
              )}
              <FeeFields draft={draft} onChange={setDraft} />
            </>
          )}
          {adding === "credit" && (
            <>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">New credit</div>
              <p className="text-[12px] text-muted">Money this order brought in that {channelName}&apos;s record doesn&apos;t show, like a shipping charge the customer paid or a reimbursement.</p>
              <CreditFields draft={credit} onChange={setCredit} />
            </>
          )}
          {adding === "shipped" && (
            <>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Shipped from</div>
              <p className="text-[12px] text-muted">
                {channelName} says &ldquo;{order.fulfillmentLabel ?? "unknown"}&rdquo;
                {detected ? `, which consl reads as ${detected.name}` : ", which consl can't place yet"}. Pick where it really shipped from.
              </p>
              <SelectMenu value={loc} options={locations} onChange={setLoc} />
            </>
          )}
          <div className="flex items-center gap-2">
            <button
              className={btnPrimary}
              disabled={pending}
              onClick={() =>
                act(
                  () =>
                    adding === "fee"
                      ? addOrderFees([order.id], parseFee(draft))
                      : adding === "credit"
                        ? addOrderCredits([order.id], parseCredit(credit))
                        : setFulfillmentOverride(order.id, loc || null),
                  close,
                )
              }
            >
              <Check size={13} /> {pending ? "Saving…" : adding === "fee" ? "Add fee" : adding === "credit" ? "Add credit" : "Save"}
            </button>
            <button className={btnSecondary} disabled={pending} onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="border-t border-line px-3 py-2 text-[12px] text-negative">{error}</p>}
    </div>
  );
}

type Scope = "all" | "from" | "period";
const SCOPES: { value: Scope; label: string }[] = [
  { value: "all", label: "All orders, past and future" },
  { value: "from", label: "From a date on" },
  { value: "period", label: "Only a date range" },
];

type RuleAction = "fee" | "void";

/** The automatic rules, in a pop-up over the Orders tab: every order that matches a FEE rule carries
 *  the fee, in the P&L under the bucket it chose; every order that matches a VOID rule is voided the
 *  way the rule says (whole order, revenue only, cost of goods only), as if voided by hand. */
export function RulesDialog({ options, onClose }: { options: FeeOptions; onClose: () => void }) {
  const router = useRouter();
  const { money, locale } = useMoney();
  const [pending, start] = useTransition();
  const [action, setAction] = useState<RuleAction>("fee");
  const [voidName, setVoidName] = useState("");
  const [voidKind, setVoidKind] = useState<VoidKind>("all");
  const [draft, setDraft] = useState<FeeDraft>(emptyFee);
  const [bucketTouched, setBucketTouched] = useState(false);
  const [channel, setChannel] = useState("");
  const [source, setSource] = useState("");
  const [method, setMethod] = useState("");
  const [where, setWhere] = useState("");
  const [tag, setTag] = useState("");
  const [scope, setScope] = useState<Scope>("all"); // past and future — the usual intent
  const [fromDay, setFromDay] = useState(options.days.today); // "From a date on" starts today
  // The picker's trigger shows the preset's dates, so the draft must hold those same concrete
  // days from the start — a rule created without opening the picker covers what it displays.
  const [period, setPeriod] = useState<Range>(() => {
    const b = rangeBounds("30", options.days.today);
    return { key: "30", from: b.from ?? options.days.oldest, to: b.to ?? options.days.today };
  });
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      setError(null);
      router.refresh();
    });
  const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const describe = (r: FeeRuleRow) =>
    [
      r.channel && CHANNEL_NAME[r.channel],
      r.source && (options.sources.find((s) => s.value === r.source)?.label ?? r.source),
      r.paymentMethod && `paid with ${paymentMethodLabel(r.paymentMethod)}`,
      r.facility && `fulfilled at ${r.facility.name}`,
      r.tag && FEE_TAGS[r.tag],
    ]
      .filter(Boolean)
      .join(" · ") || "every order";
  const when = (r: FeeRuleRow) =>
    r.period
      ? r.period.to
        ? `orders from ${day(r.period.from)} to ${day(r.period.to)}`
        : `orders from ${day(r.period.from)} on`
      : r.appliesToPast
        ? "all orders, past and future"
        : "from its creation on";
  const amount = (r: FeeRuleRow) =>
    r.kind === "percent" ? `${r.value}% of amount paid${r.extraFixed ? ` + ${money(r.extraFixed)} per order` : ""}` : `${money(r.value)} per order`;
  const methodOpt = options.paymentMethods.find((m) => m.value === method);

  // A rule keyed on a payment method is a processor's charge: it belongs under Payment processing
  // unless the operator says otherwise.
  function chooseMethod(v: string) {
    setMethod(v);
    if (!bucketTouched) setDraft((d) => ({ ...d, bucket: v ? "payment_fees" : "custom_fees" }));
  }

  const reset = () => {
    setDraft(emptyFee);
    setVoidName("");
    setVoidKind("all");
    setBucketTouched(false);
    setChannel("");
    setSource("");
    setMethod("");
    setWhere("");
    setTag("");
    setScope("all");
    setFromDay(options.days.today);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
     <div
      role="dialog"
      aria-modal="true"
      aria-label="Automatic rules"
      className="org-pop max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl"
      onClick={(e) => e.stopPropagation()}
     >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-ink">Automatic rules</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            A rule applies to every order that matches it. A <span className="font-medium text-ink-soft">fee rule</span> adds a cost consl can&apos;t read from the channel: a 3PL handling charge per order, a wholesale marketplace&apos;s commission, what a payment processor keeps. A <span className="font-medium text-ink-soft">void rule</span> voids the matching orders, the whole order or only its revenue or its cost of goods, the same as voiding them by hand.
          </p>
        </div>
        <button onClick={onClose} className={iconBtn} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      {options.rules.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-border bg-bg">
          {options.rules.map((r) => {
            const conditions = [
              r.channel && CHANNEL_NAME[r.channel],
              r.source && `Source: ${options.sources.find((s) => s.value === r.source)?.label ?? r.source}`,
              r.paymentMethod && `Paid with ${paymentMethodLabel(r.paymentMethod)}`,
              r.facility && `Fulfilled at ${r.facility.name}`,
              r.tag && `Tag: ${FEE_TAGS[r.tag]}`,
            ].filter((x): x is string => !!x);
            const whenChip = r.period
              ? r.period.to
                ? `${day(r.period.from)} – ${day(r.period.to)}`
                : `From ${day(r.period.from)}`
              : r.appliesToPast
                ? "All orders, past and future"
                : `From ${day(r.createdDay)}`;
            const does =
              r.action === "void"
                ? VOID_KIND[(r.voidKind as VoidKind) in VOID_KIND ? (r.voidKind as VoidKind) : "all"].does
                : `Adds ${amount(r)} · under ${r.bucket === "payment_fees" ? "Payment processing" : "Custom fees"}`;
            return (
              <li key={r.id} className={`grid grid-cols-[1fr_auto] items-stretch gap-x-4 gap-y-1 px-3 py-2.5 text-[13px] ${r.active ? "" : "opacity-60"}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`${r.action === "void" ? "pill-neutral" : "pill-chart"} inline-flex items-center rounded-full border px-2 py-px text-[10.5px] font-medium`}>{r.action === "void" ? "Void" : "Fee"}</span>
                    <span className="font-medium text-ink">{r.name}</span>
                    {!r.active && <span className="pill-amber inline-flex items-center rounded-full border px-2 py-px text-[10.5px] font-medium">Paused</span>}
                  </div>
                  <div className="mt-1 text-[12.5px] text-ink-soft">{does}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {(conditions.length ? conditions : ["Every order"]).map((c) => (
                      <span key={c} className="inline-flex items-center rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-soft">{c}</span>
                    ))}
                    <span className="inline-flex items-center rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{whenChip}</span>
                  </div>
                </div>
                {/* Count at the top right; the small buttons sit on the chips' row, bottom right. */}
                <div className="flex h-full flex-col items-end justify-between gap-1.5">
                  <span className="text-[12px] tabular text-muted">{r.orders.toLocaleString()} {r.orders === 1 ? "order" : "orders"}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2.5 text-[11.5px] font-medium text-ink-soft hover:border-ink/25 hover:text-ink disabled:opacity-50"
                      disabled={pending}
                      onClick={() => act(() => setFeeRuleActive(r.id, !r.active))}
                    >
                      {r.active ? "Pause" : "Resume"}
                    </button>
                    <button
                      className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2.5 text-[11.5px] font-medium text-ink-soft hover:border-negative hover:text-negative disabled:opacity-50"
                      disabled={pending}
                      onClick={() => act(() => deleteFeeRule(r.id))}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-[12.5px] font-medium text-ink">New rule</div>
          <div role="tablist" aria-label="Rule type" className="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
            {([["fee", "Fee rule"], ["void", "Void rule"]] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={action === v}
                onClick={() => setAction(v)}
                className={`flex h-full items-center rounded-md px-3 text-[12px] transition-colors ${action === v ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink-soft"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {action === "fee" ? (
          <FeeFields
            draft={draft}
            onChange={(d) => {
              if (d.bucket !== draft.bucket) setBucketTouched(true);
              setDraft(d);
            }}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
              <input value={voidName} onChange={(e) => setVoidName(e.target.value)} placeholder="Rule name, e.g. Wholesale samples" className={inputCls} maxLength={60} />
              <SelectMenu
                value={voidKind}
                onChange={(v) => setVoidKind(v as VoidKind)}
                options={(Object.keys(VOID_KIND) as VoidKind[]).map((k) => ({ value: k, label: VOID_KIND[k].label }))}
                ariaLabel="What the rule voids"
              />
            </div>
            <p className="text-[12px] text-muted">
              {VOID_KIND[voidKind].note} Change one by hand from its row menu and the rule leaves it alone from then on.
            </p>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <SelectMenu
            value={channel}
            onChange={setChannel}
            options={[{ value: "", label: "Any channel" }, ...Object.entries(CHANNEL_NAME).map(([v, l]) => ({ value: v, label: l }))]}
          />
          <SelectMenu value={source} onChange={setSource} options={[{ value: "", label: "Any sales channel" }, ...options.sources]} />
          <SelectMenu
            value={method}
            onChange={chooseMethod}
            options={[{ value: "", label: "Any payment method" }, ...options.paymentMethods.map((m) => ({ value: m.value, label: m.label }))]}
          />
          <SelectMenu value={where} onChange={setWhere} options={[{ value: "", label: "Fulfilled anywhere" }, ...options.facilities.map((f) => ({ value: f.id, label: f.name }))]} />
          <SelectMenu value={tag} onChange={setTag} options={[{ value: "", label: "Any tag" }, ...Object.entries(FEE_TAGS).map(([v, l]) => ({ value: v, label: l }))]} />
        </div>
        {methodOpt && action === "fee" && (
          <p className={`rounded-lg border px-3 py-2 text-[12px] ${methodOpt.feesRead ? "pill-amber" : "border-border text-muted"}`}>
            {methodOpt.mirror
              ? `These are ${CHANNEL_NAME[methodOpt.mirror] ?? methodOpt.mirror} sales mirrored into Shopify. consl counts them on ${CHANNEL_NAME[methodOpt.mirror] ?? methodOpt.mirror}, with ${CHANNEL_NAME[methodOpt.mirror] ?? methodOpt.mirror}'s own fees from its statements, and leaves the Shopify copy out — no rule needed here.`
              : methodOpt.feesRead
                ? `consl already reads the ${methodOpt.label} fee from ${methodOpt.channels.map((c) => CHANNEL_NAME[c] ?? c).join(" and ")} on every order paid this way${methodOpt.value === "shopify_payments" ? ", wallets included (Shop Pay, Apple Pay, Google Pay, PayPal)" : ""} — it is on the P&L under Payment processing. Only add a rule here if someone charges you on top of it.`
                : `consl reads no fee for ${methodOpt.label} orders — ${methodOpt.channels.map((c) => CHANNEL_NAME[c] ?? c).join(" and ")} doesn't report one. Add what the processor charges you.`}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Which orders" className="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
            {SCOPES.map((o) => {
              const active = scope === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setScope(o.value)}
                  className={`flex h-full items-center rounded-md px-2.5 text-[12px] transition-colors ${active ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink-soft"}`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {scope === "from" && <DatePicker value={fromDay} onChange={setFromDay} fullWidth={false} isDayDisabled={(d) => d > options.days.today} />}
          {scope === "period" && <DateRangePicker value={period} onChange={setPeriod} newest={options.days.today} oldest={options.days.oldest} locale={locale} />}
        </div>
        <div className="flex items-center gap-2">
          <button
            className={btnPrimary}
            disabled={pending}
            onClick={() =>
              act(async () => {
                const r = await createFeeRule({
                  ...(action === "void" ? { ...parseFee(emptyFee), name: voidName.trim(), action: "void" as const, voidKind } : { ...parseFee(draft), action: "fee" as const }),
                  channel: channel || null,
                  source: source || null,
                  paymentMethod: method || null,
                  facilityId: where || null,
                  tag: tag || null,
                  scope,
                  period: scope === "period" ? { from: period.from, to: period.to } : scope === "from" ? { from: fromDay, to: null } : null,
                });
                if (r.ok) reset();
                return r;
              })
            }
          >
            <Plus size={13} /> {pending ? "Saving…" : action === "void" ? "Create void rule" : "Create fee rule"}
          </button>
          {error && <span className="text-[12px] text-negative">{error}</span>}
        </div>
      </div>
     </div>
    </div>
  );
}
