"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Buildings, ChevronDown, PnlFilled } from "@/components/icons";
import { SelectMenu } from "@/components/SelectMenu";
import { useMoney } from "@/components/CurrencyProvider";
import { DateRangePicker, type Range } from "@/components/DateRangePicker";
import { GROUP_LABEL, type Pnl, type PnlGroupBlock } from "@/lib/pnl-shared";
import { ROOT_LOGO } from "@/lib/channel-logos";
import { EmptyState } from "@/components/EmptyState";

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
  filter,
  dataBounds,
  day,
}: {
  pnl: Pnl;
  filter: { range: Range };
  dataBounds: { newest: string; oldest: string };
  /** Which clock cuts a day: the channel's own reporting timezone or the company's business day. */
  day: { basis: "channel" | "company"; channel: string | null; company: string };
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

  function setDayBasis(v: string) {
    const q = new URLSearchParams(params.toString());
    if (v === "company") q.set("day", "company");
    else q.delete("day");
    router.push(`${pathname}?${q.toString()}`);
  }

  const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
  const salesBlock = pnl.groups.find((g) => g.group === "sales");
  const rest = pnl.groups.filter((g) => g.group !== "sales");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker value={filter.range} onChange={setRange} newest={dataBounds.newest} oldest={dataBounds.oldest} locale={locale} />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-soft">
          <Image src={ROOT_LOGO.AMAZON} alt="" width={14} height={14} className="rounded-[3px]" />
          Amazon
        </span>
        {day.channel && (
          <SelectMenu
            ariaLabel="Day basis"
            className="w-[250px]"
            value={day.basis}
            onChange={setDayBasis}
            options={[
              {
                value: "channel",
                label: "Amazon's day",
                hint: `${day.channel} — matches Seller Central`,
                icon: <Image src={ROOT_LOGO.AMAZON} alt="" width={16} height={16} className="rounded-[3px]" />,
              },
              {
                value: "company",
                label: "Company day",
                hint: `${day.company} — the rest of the app`,
                icon: <Buildings size={16} className="text-muted" />,
              },
            ]}
          />
        )}
        {pnl.pendingSales > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            <span className="pill-amber inline-flex items-center rounded-full border px-2 py-[3px] text-[11px] font-medium">
              {money(pnl.pendingSales)} pending
            </span>
            orders placed but not shipped yet — Amazon posts the exact money the moment they ship.
          </span>
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
        <div className="max-w-3xl overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
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

      {pnl.unmatchedSkus.length > 0 && (
        <p className="max-w-3xl text-[12px] text-muted">
          {pnl.unmatchedSkus.length} shipped SKU{pnl.unmatchedSkus.length === 1 ? " isn't" : "s aren't"} mapped to a product, so their
          units carry no cost here: {pnl.unmatchedSkus.slice(0, 4).join(", ")}
          {pnl.unmatchedSkus.length > 4 ? "…" : ""}
        </p>
      )}
    </div>
  );
}
