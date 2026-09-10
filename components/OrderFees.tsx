"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Check } from "@/components/icons";
import { inputCls } from "@/components/FormKit";
import { SelectMenu } from "@/components/SelectMenu";
import { useMoney } from "@/components/CurrencyProvider";
import { addOrderFees, removeOrderFee, setFulfillmentOverride, setFulfillmentOverrides, setOrdersVoided, createFeeRule, deleteFeeRule, setFeeRuleActive } from "@/app/orders/actions";
import type { OrderRow, FeeRuleRow } from "@/lib/order-metrics";

/**
 * Custom fees on orders: the bulk bar over a selection, the per-order "Fees & fulfillment"
 * dialog, and the fee-rules panel behind the Orders tab's gear. All writes go through the
 * server actions and refresh the page; nothing is kept locally beyond the form drafts.
 */

export type FeeOptions = { rules: FeeRuleRow[]; sources: { value: string; label: string }[]; facilities: { id: string; name: string }[] };

// Client-side copy of the rule vocabulary (the server module can't be imported here).
const FEE_TAGS: Record<string, string> = { mcf: "MCF", free_sample: "Free sample", replacement: "Replacement", free_unit: "Free unit" };
const CHANNEL_NAME: Record<string, string> = { AMAZON: "Amazon", SHOPIFY: "Shopify", TIKTOK: "TikTok" };

const btnPrimary = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-strong px-3 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50";
const btnSecondary = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12.5px] font-medium text-ink-soft hover:text-ink disabled:opacity-50";
const iconBtn = "inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink";

type Result = { ok: boolean; error?: string };
type FeeDraft = { name: string; kind: "fixed" | "percent"; value: string };
const emptyFee: FeeDraft = { name: "", kind: "fixed", value: "" };
const parseFee = (d: FeeDraft) => ({ name: d.name.trim(), kind: d.kind, value: Number(d.value.replace(",", ".")) });

/** Name + type + amount — shared by the bulk bar, the order dialog and the rule form. */
function FeeFields({ draft, onChange }: { draft: FeeDraft; onChange: (d: FeeDraft) => void }) {
  return (
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
  );
}

/** Actions over the ticked rows: void, unvoid, or put the same fee on each. */
export function BulkBar({ ids, facilities, onClear }: { ids: string[]; facilities: { id: string; name: string }[]; onClear: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [feeOpen, setFeeOpen] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [place, setPlace] = useState("");
  const [draft, setDraft] = useState<FeeDraft>(emptyFee);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      setError(null);
      setFeeOpen(false);
      setPlaceOpen(false);
      setDraft(emptyFee);
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
      <button className={btnSecondary} disabled={pending} onClick={() => run(() => setOrdersVoided(ids, false))}>
        Unvoid
      </button>
      <button className={btnSecondary} disabled={pending} onClick={() => { setFeeOpen((o) => !o); setPlaceOpen(false); }}>
        <Plus size={13} /> Add fee
      </button>
      <button className={btnSecondary} disabled={pending} onClick={() => { setPlaceOpen((o) => !o); setFeeOpen(false); }}>
        Fulfilled at…
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
    </div>
  );
}

/** One order's custom fees and its fulfilled-at correction. */
export function OrderDialog({ order, facilities, onClose }: { order: OrderRow; facilities: { id: string; name: string }[]; onClose: () => void }) {
  const router = useRouter();
  const { money } = useMoney();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<FeeDraft>(emptyFee);
  const [error, setError] = useState<string | null>(null);
  const detected = order.fulfilledAtDetected ?? (order.fulfilledAt && !order.fulfilledAtDetected ? order.fulfilledAt : null);
  const [loc, setLoc] = useState(order.fulfilledAtDetected ? (order.fulfilledAt?.id ?? "") : "");
  const act = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      setError(null);
      router.refresh();
    });
  const locations = [
    { value: "", label: detected ? `Keep detected (${detected.name})` : "Keep as detected (nowhere yet)" },
    ...facilities.filter((f) => f.id !== detected?.id).map((f) => ({ value: f.id, label: f.name })),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="org-pop max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold text-ink">Order {order.orderNumber ?? ""}</div>
            <div className="text-[12px] text-muted">
              {CHANNEL_NAME[order.channel] ?? order.channel} · {money(order.total)} paid
            </div>
          </div>
          <button onClick={onClose} className={iconBtn} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <section className="mt-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Custom fees</div>
          {order.fees.length === 0 ? (
            <p className="mt-1 text-[12.5px] text-muted">No custom fees on this order.</p>
          ) : (
            <ul className="mt-1 divide-y divide-line rounded-lg border border-border">
              {order.fees.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-ink">{f.name}</span>
                    {f.fromRule && <span className="pill-neutral inline-flex items-center rounded-full border px-1.5 py-px text-[10.5px] font-medium">rule</span>}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="tabular text-ink-soft">−{money(f.amount)}</span>
                    {!f.fromRule && (
                      <button className={iconBtn} disabled={pending} onClick={() => act(() => removeOrderFee(f.id))} aria-label="Remove fee">
                        <X size={13} />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-col gap-2">
            <FeeFields draft={draft} onChange={setDraft} />
            <button
              className={`${btnPrimary} self-start`}
              disabled={pending}
              onClick={() =>
                act(async () => {
                  const r = await addOrderFees([order.id], parseFee(draft));
                  if (r.ok) setDraft(emptyFee);
                  return r;
                })
              }
            >
              <Plus size={13} /> Add fee
            </button>
          </div>
        </section>

        <section className="mt-5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Fulfilled at</div>
          <p className="mt-1 text-[12.5px] text-muted">
            {CHANNEL_NAME[order.channel] ?? order.channel} says &ldquo;{order.fulfillmentLabel ?? "unknown"}&rdquo;
            {detected ? `, which consl reads as ${detected.name}` : ", which consl can't place yet"}. Pick the facility it really shipped from — the
            detected one stays on the record, struck through.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <SelectMenu value={loc} options={locations} onChange={setLoc} />
            <button
              className={`${btnPrimary} self-start`}
              disabled={pending}
              onClick={() => act(() => setFulfillmentOverride(order.id, loc || null))}
            >
              <Check size={13} /> Save location
            </button>
          </div>
        </section>

        {error && <p className="mt-3 text-[12px] text-negative">{error}</p>}
      </div>
    </div>
  );
}

/** The rules: every order that matches carries the fee, in the P&L under Custom fees. */
export function FeeRulesPanel({ options, onClose }: { options: FeeOptions; onClose: () => void }) {
  const router = useRouter();
  const { money } = useMoney();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<FeeDraft>(emptyFee);
  const [channel, setChannel] = useState("");
  const [source, setSource] = useState("");
  const [where, setWhere] = useState("");
  const [tag, setTag] = useState("");
  const [past, setPast] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      setError(null);
      router.refresh();
    });
  const describe = (r: FeeRuleRow) =>
    [
      r.channel && CHANNEL_NAME[r.channel],
      r.source && (options.sources.find((s) => s.value === r.source)?.label ?? r.source),
      r.facility && `fulfilled at ${r.facility.name}`,
      r.tag && FEE_TAGS[r.tag],
    ]
      .filter(Boolean)
      .join(" · ") || "every order";
  const amount = (r: FeeRuleRow) => (r.kind === "percent" ? `${r.value}% of amount paid` : `${money(r.value)} per order`);

  return (
    <div className="dropdown-in rounded-[var(--radius-card)] border border-border bg-surface-2/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Fee rules</div>
          <p className="mt-1 max-w-[72ch] text-[12.5px] text-muted">
            A cost added to every order that matches — a marketplace commission consl can&apos;t see on its own, a handling charge per MCF
            shipment. Rules show in the P&amp;L under Custom fees.
          </p>
        </div>
        <button onClick={onClose} className={iconBtn} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      {options.rules.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-border bg-bg">
          {options.rules.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px] ${r.active ? "" : "opacity-60"}`}>
              <span className="font-medium text-ink">{r.name}</span>
              <span className="text-muted">
                {amount(r)} · {describe(r)}
                {r.appliesToPast ? " · past orders too" : ""}
              </span>
              <span className="text-[12px] text-muted">{r.orders.toLocaleString()} orders</span>
              <span className="ml-auto flex items-center gap-1">
                <button className={btnSecondary} disabled={pending} onClick={() => act(() => setFeeRuleActive(r.id, !r.active))}>
                  {r.active ? "Pause" : "Resume"}
                </button>
                <button className={btnSecondary} disabled={pending} onClick={() => act(() => deleteFeeRule(r.id))}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
        <div className="text-[12.5px] font-medium text-ink">New rule</div>
        <FeeFields draft={draft} onChange={setDraft} />
        <div className="grid gap-2 sm:grid-cols-4">
          <SelectMenu
            value={channel}
            onChange={setChannel}
            options={[{ value: "", label: "Any channel" }, ...Object.entries(CHANNEL_NAME).map(([v, l]) => ({ value: v, label: l }))]}
          />
          <SelectMenu value={source} onChange={setSource} options={[{ value: "", label: "Any sales channel" }, ...options.sources]} />
          <SelectMenu value={where} onChange={setWhere} options={[{ value: "", label: "Fulfilled anywhere" }, ...options.facilities.map((f) => ({ value: f.id, label: f.name }))]} />
          <SelectMenu value={tag} onChange={setTag} options={[{ value: "", label: "Any tag" }, ...Object.entries(FEE_TAGS).map(([v, l]) => ({ value: v, label: l }))]} />
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
          <input type="checkbox" checked={past} onChange={(e) => setPast(e.target.checked)} className="h-4 w-4 accent-accent-strong" />
          Also apply to past orders
        </label>
        <div className="flex items-center gap-2">
          <button
            className={btnPrimary}
            disabled={pending}
            onClick={() =>
              act(async () => {
                const r = await createFeeRule({ ...parseFee(draft), channel: channel || null, source: source || null, facilityId: where || null, tag: tag || null, appliesToPast: past });
                if (r.ok) {
                  setDraft(emptyFee);
                  setChannel("");
                  setSource("");
                  setWhere("");
                  setTag("");
                }
                return r;
              })
            }
          >
            <Plus size={13} /> {pending ? "Saving…" : "Create rule"}
          </button>
          {error && <span className="text-[12px] text-negative">{error}</span>}
        </div>
      </div>
    </div>
  );
}
