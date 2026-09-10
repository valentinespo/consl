"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, PnlFilled, X } from "@/components/icons";
import { useMoney } from "@/components/CurrencyProvider";
import { DateRangePicker, type Range } from "@/components/DateRangePicker";
import { GROUP_LABEL, PNL_CHANNEL_LABEL, type Pnl, type PnlChannel, type PnlGroupBlock } from "@/lib/pnl-shared";
import { ROOT_LOGO } from "@/lib/channel-logos";
import { EmptyState } from "@/components/EmptyState";
import { SkuAvatar } from "@/components/ui";
import { useCan } from "@/components/AccessProvider";
import { savePreConslCosts } from "@/app/pnl/actions";

/** "FBAPerUnitFulfillmentFee" → "FBA per unit fulfillment fee"; refund prefixes fold away. */
function humanize(raw: string): string {
  const [prefix, rest] = raw.includes(":") ? [raw.slice(0, raw.indexOf(":")), raw.slice(raw.indexOf(":") + 1)] : [null, raw];
  const spell = (s: string) =>
    s
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .toLowerCase()
      .trim();
  let label = spell(rest);
  if (prefix && prefix !== "Refund" && prefix !== "TaxWithheld") label = `${spell(prefix)} · ${label}`;
  label = label.charAt(0).toUpperCase() + label.slice(1);
  return label.replace(/\bfba\b/gi, "FBA").replace(/\bmcf\b/gi, "MCF");
}

function Amount({ value, money, bold = false }: { value: number; money: (n: number) => string; bold?: boolean }) {
  const negative = value < 0;
  return (
    <span className={`tabular ${bold ? "font-semibold" : ""} ${negative ? "text-ink-soft" : "text-ink"}`}>
      {negative ? `−${money(Math.abs(value))}` : money(value)}
    </span>
  );
}

function GroupRow({ block, money }: { block: PnlGroupBlock; money: (n: number) => string }) {
  const [open, setOpen] = useState(false);
  const expandable = block.types.length > 1 || (block.types.length === 1 && block.types[0].type !== block.group);
  return (
    <>
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[13px] ${
          expandable ? "hover:bg-surface-2/60" : "cursor-default"
        }`}
      >
        <span className="flex items-center gap-1.5 font-medium text-ink">
          {GROUP_LABEL[block.group] ?? block.group}
          {expandable && <ChevronDown size={13} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />}
        </span>
        <Amount value={block.total} money={money} />
      </button>
      {open &&
        block.types.map((t) => (
          <div key={t.type} className="dropdown-in flex items-center justify-between gap-3 px-4 py-1.5 pl-8 text-[12.5px] text-ink-soft">
            <span className="min-w-0 truncate">{humanize(t.type)}</span>
            <Amount value={t.amount} money={money} />
          </div>
        ))}
    </>
  );
}

export function PnlClient({
  pnl,
  channels,
  filter,
  dataBounds,
}: {
  pnl: Pnl;
  /** Channels with data, in display order — the filter's choices. */
  channels: PnlChannel[];
  filter: { range: Range; channel: string };
  dataBounds: { newest: string; oldest: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { money, locale } = useMoney();

  function setRange(r: Range) {
    const q = new URLSearchParams(params.toString());
    q.set("range", r.key);
    if (r.key === "custom") {
      q.set("from", r.from);
      q.set("to", r.to);
    } else {
      q.delete("from");
      q.delete("to");
    }
    router.push(`${pathname}?${q.toString()}`);
  }

  function setChannel(channel: string) {
    const q = new URLSearchParams(params.toString());
    if (channel) q.set("channel", channel.toLowerCase());
    else q.delete("channel");
    router.push(`${pathname}?${q.toString()}`);
  }

  const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
  const salesBlock = pnl.groups.find((g) => g.group === "sales");
  const rest = pnl.groups.filter((g) => g.group !== "sales");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker value={filter.range} onChange={setRange} newest={dataBounds.newest} oldest={dataBounds.oldest} locale={locale} />
        {channels.length > 1 && (
          <div role="radiogroup" aria-label="Channel" className="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
            {[{ v: "", label: "All channels", logo: null as string | null }, ...channels.map((c) => ({ v: c, label: PNL_CHANNEL_LABEL[c], logo: ROOT_LOGO[c] ?? null }))].map((o) => {
              const active = filter.channel === o.v;
              return (
                <button
                  key={o.v || "all"}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setChannel(o.v)}
                  className={`flex h-full items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors ${
                    active ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink-soft"
                  }`}
                >
                  {o.logo && <Image src={o.logo} alt="" width={14} height={14} className="rounded-[3px]" />}
                  {o.label}
                </button>
              );
            })}
          </div>
        )}
        {pnl.backfillInProgress && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
            Importing your fee history in the background — older periods fill in on their own.
          </span>
        )}
      </div>

      {!pnl.hasData ? (
        <EmptyState
          icon={PnlFilled}
          title="No ledger data for this period yet"
          body="Amazon's financial events are importing in the background. Fresh fees post within the hour; history fills in window by window."
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="divide-y divide-line">
            {salesBlock && <GroupRow block={salesBlock} money={money} />}
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
              <span className="font-medium text-ink">
                Cost of goods
                <span className="ml-2 text-[11.5px] font-normal text-muted">
                  {pnl.unitsSold.toLocaleString()} units at landed cost
                </span>
              </span>
              <Amount value={pnl.cogs} money={money} />
            </div>
            {pnl.mcf.units > 0 && (
              <div className="flex items-center justify-between gap-3 px-4 py-1.5 pl-8 text-[12.5px] text-ink-soft">
                <span className="min-w-0 truncate">
                  of which MCF orders · {pnl.mcf.units.toLocaleString()} units
                  <span className="ml-1.5 text-[11.5px] text-muted">shipped by Amazon for another channel, no sale reported</span>
                </span>
                <Amount value={pnl.mcf.cogs} money={money} />
              </div>
            )}
            {rest.map((g) => (
              <GroupRow key={g.group} block={g} money={money} />
            ))}
          </div>
          <div className="border-t border-border bg-surface-2/40">
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-[14px]">
              <span className="font-semibold text-ink">Net profit</span>
              <span className={`tabular font-semibold ${pnl.netProfit >= 0 ? "text-positive" : "text-negative"}`}>
                {pnl.netProfit < 0 ? `−${money(Math.abs(pnl.netProfit))}` : money(pnl.netProfit)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 pb-3 text-[12.5px] text-ink-soft">
              <span>Margin {pct(pnl.margin)}</span>
              <span>ROI {pct(pnl.roi)}</span>
            </div>
          </div>
        </div>
      )}

      {pnl.pending.map((p) => (
        <div key={p.channel} className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <span className="pill-amber inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-medium">
            {ROOT_LOGO[p.channel] && <Image src={ROOT_LOGO[p.channel]} alt="" width={14} height={14} className="rounded-[3px]" />}
            {PNL_CHANNEL_LABEL[p.channel]}
            <span>{money(p.sales)} pending</span>
          </span>
          <span>
            Orders placed that {PNL_CHANNEL_LABEL[p.channel]} hasn&apos;t posted the money for yet. They already count in this P&amp;L — the sale
            at the order&apos;s price, the fees estimated from your past orders. When {PNL_CHANNEL_LABEL[p.channel]} posts the real money,
            that replaces the estimate.
          </span>
        </div>
      ))}
      {pnl.preHistoryUnits > 0 && (
        <p className="text-[12px] text-muted">
          {pnl.preHistoryUnits.toLocaleString()} of the units sold predate the first shipment on record for their product, so they carry the
          pre-consl average cost (set it with the button top right; until then the starting cost stands in).
        </p>
      )}
      {pnl.overflowUnits > 0 && (
        <p className="text-[12px] text-muted">
          {pnl.overflowUnits.toLocaleString()} units were sold beyond what was recorded as shipped, so they carry the newest cost on record.
        </p>
      )}
      {pnl.unplacedUnits > 0 && (
        <p className="text-[12px] text-muted">
          {pnl.unplacedUnits.toLocaleString()} unit{pnl.unplacedUnits === 1 ? "" : "s"} sold in this period come from orders not placed at any facility, so they
          carry no cost here. Set &ldquo;Fulfilled at&rdquo; on those orders from the Orders tab and they will be priced from that facility&apos;s stock.
        </p>
      )}
      {pnl.unmatchedSkus.length > 0 && (
        <p className="text-[12px] text-muted">
          {pnl.unmatchedSkus.length} product{pnl.unmatchedSkus.length === 1 ? " has" : "s have"} no landed cost yet, so
          {pnl.unmatchedSkus.length === 1 ? " its" : " their"} units carry no cost here: {pnl.unmatchedSkus.slice(0, 4).join(", ")}
          {pnl.unmatchedSkus.length > 4 ? "…" : ""}
        </p>
      )}
      {pnl.ignored.skus.length > 0 && (
        <p className="text-[12px] text-muted">
          Left out: {pnl.ignored.units.toLocaleString()} unit{pnl.ignored.units === 1 ? "" : "s"} ({money(pnl.ignored.sales)} in sales) from{" "}
          {pnl.ignored.skus.length} listing{pnl.ignored.skus.length === 1 ? "" : "s"} not managed in consl — {pnl.ignored.skus.slice(0, 4).join(", ")}
          {pnl.ignored.skus.length > 4 ? "…" : ""}. Map {pnl.ignored.skus.length === 1 ? "it" : "them"} to a product to include{" "}
          {pnl.ignored.skus.length === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}


/* ---------------------------- Pre-consl average cost ----------------------------
 * The cost of a unit sold before consl kept the books — what prices sales that predate a
 * product's first recorded shipment. One number per product, entered once. */
type CostProduct = { id: string; code: string; name: string; imageUrl: string | null; preConslUnitCost: number | null; openingUnitCost: number | null };

export function PreConslCostButton({ products }: { products: CostProduct[] }) {
  const canEdit = useCan("catalog", "edit");
  const router = useRouter();
  const { money } = useMoney();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canEdit || products.length === 0) return null;

  const value = (p: CostProduct) => draft[p.id] ?? (p.preConslUnitCost != null ? String(p.preConslUnitCost) : "");
  const dirty = products.some((p) => draft[p.id] !== undefined && draft[p.id] !== (p.preConslUnitCost != null ? String(p.preConslUnitCost) : ""));
  const missing = products.filter((p) => p.preConslUnitCost == null).length;

  function close() {
    setOpen(false);
    setDraft({});
    setError(null);
  }
  async function save() {
    setPending(true);
    setError(null);
    try {
      const entries = products
        .filter((p) => draft[p.id] !== undefined)
        .map((p) => ({ productId: p.id, cost: draft[p.id].trim() === "" ? null : Number(draft[p.id]) }));
      if (entries.some((e) => e.cost != null && !Number.isFinite(e.cost))) {
        setError("Enter a number for every cost you fill in.");
        return;
      }
      const r = await savePreConslCosts(entries);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] font-medium text-ink-soft hover:bg-surface-2"
        title="The cost of a unit sold before consl kept your books"
      >
        Pre-consl Avg COG
        {missing > 0 && <span className="pill-amber inline-flex items-center rounded-full border px-1.5 py-[1px] text-[10.5px] font-medium">{missing} unset</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            className="org-pop max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink">Pre-consl average cost of goods</h3>
              <button type="button" onClick={close} className="text-muted hover:text-ink" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
              What one unit cost you before consl kept the books. Sales that predate a product&apos;s first recorded shipment are
              priced at this; everything after is first-in-first-out from real shipments. Leave blank to use the starting cost from
              onboarding.
            </p>
            <div className="divide-y divide-line">
              {products.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2">
                  <SkuAvatar code={p.code} size={28} imageUrl={p.imageUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">{p.code}</div>
                    <div className="truncate text-[11.5px] text-muted">{p.name}</div>
                  </div>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12.5px] text-muted">$</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={value(p)}
                      onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                      placeholder={p.openingUnitCost != null ? money(p.openingUnitCost, 2).replace(/^[^0-9]*/, "") : "0.00"}
                      className="h-9 w-28 rounded-lg border border-border bg-surface pl-6 pr-2.5 text-right text-[13px] tabular text-ink outline-none focus:border-accent-strong"
                    />
                  </div>
                </div>
              ))}
            </div>
            {error && <div className="mt-3 text-[12.5px] text-negative">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending || !dirty}
                className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
