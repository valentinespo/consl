"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, PnlFilled, Receipt, X } from "@/components/icons";
import { useMoney } from "@/components/CurrencyProvider";
import { DateRangePicker, type Range } from "@/components/DateRangePicker";
import { SelectMenu } from "@/components/SelectMenu";
import { GROUP_LABEL, GROUP_ORDER, PNL_BREAKDOWNS, PNL_CHANNEL_LABEL, PNL_SOURCE_LABEL, PNL_SOURCE_ORDER, parsePnlBreakdown, type Pnl, type PnlBreakdown, type PnlChannel, type PnlGroupBlock, type PnlHistory, type PnlPeriod, type PnlSource, type PnlStatement } from "@/lib/pnl-shared";
import { aggregatePnlDays, foldPnl, pnlPeriodHeading, pnlPeriodRanges } from "@/lib/pnl-periods";
import { rangeBounds } from "@/lib/chart";
import { readSavedPnlView, saveSavedPnlView } from "@/lib/pnl-view";
import { ROOT_LOGO, SOURCE_LOGO } from "@/lib/channel-logos";
import { EmptyState } from "@/components/EmptyState";
import { SkuAvatar } from "@/components/ui";
import { useCan } from "@/components/AccessProvider";
import { savePreConslCosts } from "@/app/(app)/pnl/actions";

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

/** Where a line's money comes from, as the platform's mark — stacked when a line mixes sources. */
function SourceMarks({ sources, size = 14 }: { sources: PnlSource[]; size?: number }) {
  if (!sources.length) return null;
  return (
    <span className="inline-flex shrink-0 items-center -space-x-1" aria-label={sources.map((x) => PNL_SOURCE_LABEL[x]).join(", ")}>
      {sources.map((x) =>
        x === "CUSTOM" ? (
          <span
            key={x}
            title={PNL_SOURCE_LABEL[x]}
            className="inline-flex items-center justify-center rounded-[3px] bg-surface-2 text-ink-soft ring-1 ring-surface"
            style={{ width: size, height: size }}
          >
            <Receipt size={size - 3} />
          </span>
        ) : (
          <Image
            key={x}
            src={SOURCE_LOGO[x]}
            alt=""
            title={PNL_SOURCE_LABEL[x]}
            width={size}
            height={size}
            className={`rounded-[3px] ring-1 ring-surface ${x === "CONSL" ? "iso-invert" : ""}`}
          />
        ),
      )}
    </span>
  );
}

/** Every source the block's lines draw on, in the fixed platform order. */
function blockSources(block: PnlGroupBlock): PnlSource[] {
  const seen = new Set(block.types.flatMap((t) => t.sources));
  return PNL_SOURCE_ORDER.filter((x) => seen.has(x));
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
        <span className="flex items-center gap-2 font-medium text-ink">
          {/* A collapsible group is a subtotal — its lines carry the marks. A single-line group is the line. */}
          {!expandable && <SourceMarks sources={blockSources(block)} />}
          {GROUP_LABEL[block.group] ?? block.group}
          {expandable && <ChevronDown size={13} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />}
        </span>
        <Amount value={block.total} money={money} />
      </button>
      {open &&
        block.types.map((t) => (
          <div key={t.type} className="dropdown-in flex items-center justify-between gap-3 px-4 py-1.5 pl-8 text-[12.5px] text-ink-soft">
            <span className="flex min-w-0 items-center gap-2">
              <SourceMarks sources={t.sources} size={13} />
              <span className="min-w-0 truncate">{humanize(t.type)}</span>
            </span>
            <Amount value={t.amount} money={money} />
          </div>
        ))}
    </>
  );
}

/* ---------------------------- Breakdown table ----------------------------
 * Fixed geometry: the label column, then Total, then one column per period, every value column
 * the same width whatever the breakdown — a single "2026" column never stretches to fill the
 * card; the space to its right simply stays empty (a trailing filler column carries the row
 * lines across). Label and Total stay pinned while the periods scroll. Newest period first. */
const VALUE_COL_W = 180;
const periodLabelCell = "sticky left-0 z-10 bg-surface px-4 text-left";
const periodValueCell = (index: number) => `px-4 text-right whitespace-nowrap ${index === 0 ? "sm:sticky sm:left-[var(--pnl-label-width)] sm:z-10 bg-surface-2 border-r border-border" : ""}`;
const periodRowBorder = "[&>th]:border-t [&>td]:border-t [&>th]:border-line [&>td]:border-line";
const Filler = () => <td aria-hidden className="border-t border-line" />;

function PeriodGroupRows({ block, statements, money }: { block: PnlGroupBlock; statements: PnlStatement[]; money: (n: number) => string }) {
  const [open, setOpen] = useState(false);
  const expandable = block.types.length > 1 || (block.types.length === 1 && block.types[0].type !== block.group);
  const groups = statements.map((statement) => statement.groups.find((group) => group.group === block.group));
  return (
    <>
      <tr className={`${periodRowBorder} text-[13px]`}>
        <th scope="row" className={`${periodLabelCell} py-2.5 font-medium text-ink`}>
          <button type="button" onClick={() => expandable && setOpen((value) => !value)} aria-expanded={expandable ? open : undefined} className={`flex w-full items-center gap-2 text-left ${expandable ? "hover:text-accent" : "cursor-default"}`}>
            {!expandable && <SourceMarks sources={blockSources(block)} />}
            {GROUP_LABEL[block.group] ?? block.group}
            {expandable && <ChevronDown size={13} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />}
          </button>
        </th>
        {groups.map((group, index) => <td key={index} className={`${periodValueCell(index)} py-2.5`}><Amount value={group?.total ?? 0} money={money} /></td>)}
        <Filler />
      </tr>
      {open && block.types.map((type) => (
        <tr key={type.type} className="dropdown-in text-[12.5px] text-ink-soft">
          <th scope="row" className={`${periodLabelCell} py-1.5 pl-8 font-normal`}>
            <span className="flex items-center gap-2"><SourceMarks sources={type.sources} size={13} /><span title={humanize(type.type)} className="truncate">{humanize(type.type)}</span></span>
          </th>
          {groups.map((group, index) => <td key={index} className={`${periodValueCell(index)} py-1.5`}><Amount value={group?.types.find((row) => row.type === type.type)?.amount ?? 0} money={money} /></td>)}
          <Filler />
        </tr>
      ))}
    </>
  );
}

/** Cost of goods across the columns. The units live in the row's label only (like the plain
 *  statement); the "of which" lines (MCF, free units) sit behind a chevron. */
function PeriodCogsRows({ pnl, statements, money, locale }: { pnl: Pnl; statements: PnlStatement[]; money: (n: number) => string; locale: string }) {
  const [open, setOpen] = useState(false);
  const expandable = pnl.mcf.units > 0 || pnl.unreported.units > 0;
  const sub = (key: string, label: string, units: number, value: (statement: PnlStatement) => number) => (
    <tr key={key} className="dropdown-in text-[12.5px] text-ink-soft">
      <th scope="row" className={`${periodLabelCell} py-1.5 pl-8 font-normal`}>
        <span className="flex items-center gap-2">
          <SourceMarks sources={["CONSL"]} size={13} />
          <span className="truncate">
            {label}
            <span className="ml-1.5 text-[11.5px] text-muted">{units.toLocaleString(locale)} units</span>
          </span>
        </span>
      </th>
      {statements.map((statement, index) => <td key={index} className={`${periodValueCell(index)} py-1.5`}><Amount value={value(statement)} money={money} /></td>)}
      <Filler />
    </tr>
  );
  return (
    <>
      <tr className={`${periodRowBorder} text-[13px]`}>
        <th scope="row" className={`${periodLabelCell} py-2.5 font-medium text-ink`}>
          <button type="button" onClick={() => expandable && setOpen((value) => !value)} aria-expanded={expandable ? open : undefined} className={`flex w-full items-center gap-2 text-left ${expandable ? "hover:text-accent" : "cursor-default"}`}>
            <SourceMarks sources={["CONSL"]} />
            <span className="min-w-0 truncate">
              Cost of goods
              <span className="ml-2 text-[11.5px] font-normal text-muted">{pnl.unitsSold.toLocaleString(locale)} units at landed cost</span>
            </span>
            {expandable && <ChevronDown size={13} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />}
          </button>
        </th>
        {statements.map((statement, index) => <td key={index} className={`${periodValueCell(index)} py-2.5`}><Amount value={statement.cogs} money={money} /></td>)}
        <Filler />
      </tr>
      {open && pnl.mcf.units > 0 && sub("mcf", "of which MCF orders", pnl.mcf.units, (statement) => statement.mcf.cogs)}
      {open && pnl.unreported.units > 0 && sub("unreported", "of which free units & replacements", pnl.unreported.units, (statement) => statement.unreported.cogs)}
    </>
  );
}

function PnlBreakdownTable({ pnl, periods, breakdown, money, locale }: { pnl: Pnl; periods: PnlPeriod[]; breakdown: PnlBreakdown; money: (n: number) => string; locale: string }) {
  // Newest period first, like a statement is read: this month, then the ones before it.
  const ordered = [...periods].reverse();
  const statements: PnlStatement[] = [pnl, ...ordered.map((period) => period.statement)];
  // Include a line even when opposite movements in different periods cancel out in Total.
  const groups = GROUP_ORDER.flatMap((group) => {
    const blocks = statements.flatMap((statement) => statement.groups.filter((block) => block.group === group));
    if (!blocks.length) return [];
    const types = new Map<string, PnlGroupBlock["types"][number]>();
    for (const block of blocks) for (const type of block.types) {
      const current = types.get(type.type);
      types.set(type.type, { ...type, sources: PNL_SOURCE_ORDER.filter((source) => type.sources.includes(source) || current?.sources.includes(source)) });
    }
    return [{ group, total: blocks[0].total, types: [...types.values()] }];
  });
  const pct = (value: number | null) => value == null ? "—" : `${(value * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
  function row(key: string, label: ReactNode, value: (statement: PnlStatement) => ReactNode, summary = false) {
    return (
      <tr key={key} className={`${periodRowBorder} ${summary ? "bg-surface-2/40 text-[14px]" : "text-[13px]"}`}>
        <th scope="row" className={`${periodLabelCell} py-2.5 ${summary ? "font-semibold" : "font-medium"} text-ink`}>{label}</th>
        {statements.map((statement, index) => <td key={index} className={`${periodValueCell(index)} py-2.5`}>{value(statement)}</td>)}
        <Filler />
      </tr>
    );
  }
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      <div role="region" aria-label="P&L by period" tabIndex={0} className="overflow-x-auto [--pnl-label-width:200px] sm:[--pnl-label-width:300px]">
        <table className="w-full table-fixed border-separate border-spacing-0">
          <caption className="sr-only">Profit and loss for the selected date range, with totals and a breakdown {PNL_BREAKDOWNS.find((option) => option.value === breakdown)?.label.toLowerCase()}.</caption>
          <colgroup>
            <col className="w-[var(--pnl-label-width)]" />
            {statements.map((_, index) => <col key={index} style={{ width: VALUE_COL_W }} />)}
            <col />
          </colgroup>
          <thead>
            {/* One fixed-height row, every heading on the same centre line. A partial period's note
                floats in the cell's bottom edge instead of stacking, so it never pushes the row taller. */}
            <tr className="h-12 text-[13px] text-ink-soft">
              <th scope="col" className={`${periodLabelCell} align-middle font-medium`}>P&amp;L</th>
              <th scope="col" className={`${periodValueCell(0)} align-middle font-semibold text-ink`}>Total</th>
              {ordered.map((period) => {
                const heading = pnlPeriodHeading(period, breakdown, locale);
                return (
                  <th scope="col" key={period.key} className="relative px-4 text-right align-middle font-medium whitespace-nowrap">
                    {heading.label}
                    {heading.note && <span className="absolute bottom-[3px] right-4 text-[10px] font-normal leading-none text-muted">{heading.note}</span>}
                  </th>
                );
              })}
              <th aria-hidden />
            </tr>
          </thead>
          <tbody>
            {groups.filter((group) => group.group === "sales").map((block) => <PeriodGroupRows key={block.group} block={block} statements={statements} money={money} />)}
            <PeriodCogsRows pnl={pnl} statements={statements} money={money} locale={locale} />
            {groups.filter((group) => group.group !== "sales").map((block) => <PeriodGroupRows key={block.group} block={block} statements={statements} money={money} />)}
            {row("profit", "Net profit", (statement) => <span className={`tabular font-semibold ${statement.netProfit >= 0 ? "text-positive" : "text-negative"}`}>{statement.netProfit < 0 ? `−${money(Math.abs(statement.netProfit))}` : money(statement.netProfit)}</span>, true)}
            {row("margin", <span className="font-normal text-ink-soft">Margin</span>, (statement) => <span className="tabular text-ink-soft">{pct(statement.margin)}</span>)}
            {row("roi", <span className="font-normal text-ink-soft">ROI</span>, (statement) => <span className="tabular text-ink-soft">{pct(statement.roi)}</span>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Cost of goods in the plain statement: consl's mark, the units at landed cost, and — behind a
 *  chevron — the "of which" lines (MCF orders, free units) that used to sit open underneath. */
function CogsRow({ pnl, money }: { pnl: Pnl; money: (n: number) => string }) {
  const [open, setOpen] = useState(false);
  const expandable = pnl.mcf.units > 0 || pnl.unreported.units > 0;
  return (
    <>
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[13px] ${expandable ? "hover:bg-surface-2/60" : "cursor-default"}`}
      >
        <span className="flex min-w-0 items-center gap-2 font-medium text-ink">
          <SourceMarks sources={["CONSL"]} />
          <span className="min-w-0 truncate">
            Cost of goods
            <span className="ml-2 text-[11.5px] font-normal text-muted">{pnl.unitsSold.toLocaleString()} units at landed cost</span>
          </span>
          {expandable && <ChevronDown size={13} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />}
        </span>
        <Amount value={pnl.cogs} money={money} />
      </button>
      {open && pnl.mcf.units > 0 && (
        <div className="dropdown-in flex items-center justify-between gap-3 px-4 py-1.5 pl-8 text-[12.5px] text-ink-soft">
          <span className="flex min-w-0 items-center gap-2">
            <SourceMarks sources={["CONSL"]} size={13} />
            <span className="min-w-0 truncate">
              of which MCF orders · {pnl.mcf.units.toLocaleString()} units
              <span className="ml-1.5 text-[11.5px] text-muted">shipped by Amazon for another channel, no sale reported</span>
            </span>
          </span>
          <Amount value={pnl.mcf.cogs} money={money} />
        </div>
      )}
      {open && pnl.unreported.units > 0 && (
        <div className="dropdown-in flex items-center justify-between gap-3 px-4 py-1.5 pl-8 text-[12.5px] text-ink-soft">
          <span className="flex min-w-0 items-center gap-2">
            <SourceMarks sources={["CONSL"]} size={13} />
            <span className="min-w-0 truncate">
              of which free units &amp; replacements · {pnl.unreported.units.toLocaleString()} units
              <span className="ml-1.5 text-[11.5px] text-muted">shipped, but Amazon reported no money for them</span>
            </span>
          </span>
          <Amount value={pnl.unreported.cogs} money={money} />
        </div>
      )}
    </>
  );
}

type Filter = { range: Range; channel: string; breakdown: PnlBreakdown };

export function PnlClient({ history, initial }: { history: PnlHistory; initial: Filter }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { money, locale } = useMoney();

  // The window, the channel and the breakdown are browser state. Changing any of them cuts a new
  // statement out of the shipped history instantly, and the URL is kept in step (bookmarkable,
  // survives a reload) without a navigation — the server is never asked to recompute anything.
  const [filter, setFilter] = useState<Filter>(initial);
  const channels = history.channels;
  // Opening the tab plain (no window in the address) brings back the last view this browser had.
  // The sidebar's P&L link already carries it, so this only matters for a typed or bookmarked
  // bare URL — the presets re-resolve to today, a custom window keeps its dates.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (restored) return;
    setRestored(true);
    if (params.has("range") || params.has("channel") || params.has("breakdown")) return;
    const saved = readSavedPnlView();
    if (!saved) return;
    const b = rangeBounds(saved.range.key, history.newest, saved.range.from, saved.range.to);
    const next: Filter = { ...saved, range: { key: saved.range.key, from: b.from ?? history.oldest, to: b.to ?? history.newest } };
    setFilter(next);
    syncUrl(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const selected = useMemo(
    () => (filter.channel && (channels as string[]).includes(filter.channel) ? [filter.channel as PnlChannel] : channels),
    [filter.channel, channels],
  );
  const pnl = useMemo(() => foldPnl(history, filter.range.from, filter.range.to, selected), [history, filter.range.from, filter.range.to, selected]);
  const periods = useMemo(
    () => (filter.breakdown === "none" ? [] : aggregatePnlDays(history.days, pnlPeriodRanges(filter.range.from, filter.range.to, filter.breakdown), selected)),
    [history.days, filter.breakdown, filter.range.from, filter.range.to, selected],
  );
  const breakdown = filter.breakdown;
  const dataBounds = { newest: history.newest, oldest: history.oldest };

  function syncUrl(next: Filter) {
    const q = new URLSearchParams(params.toString());
    q.set("range", next.range.key);
    if (next.range.key === "custom") {
      q.set("from", next.range.from);
      q.set("to", next.range.to);
    } else {
      q.delete("from");
      q.delete("to");
    }
    if (next.channel) q.set("channel", next.channel.toLowerCase());
    else q.delete("channel");
    if (next.breakdown === "none") q.delete("breakdown");
    else q.set("breakdown", next.breakdown);
    const qs = q.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }
  function update(change: Partial<Filter>) {
    const next = { ...filter, ...change };
    setFilter(next);
    syncUrl(next);
    saveSavedPnlView(next);
  }
  const setRange = (r: Range) => update({ range: { key: r.key, from: r.from || history.oldest, to: r.to || history.newest } });
  const setChannel = (channel: string) => update({ channel });
  const setBreakdown = (value: string) => update({ breakdown: parsePnlBreakdown(value) });

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
        <SelectMenu prefix="Breakdown" value={breakdown} onChange={setBreakdown} options={[...PNL_BREAKDOWNS]} ariaLabel="P&L breakdown" className="w-[228px]" />
        {pnl.importProgress && (
          <span className="inline-flex flex-wrap items-center gap-2 text-[12px] text-muted" title="Amazon's money report is read a week at a time, from today back to two years ago. Older periods fill in as it goes.">
            <span className={`h-1.5 w-1.5 rounded-full ${pnl.importProgress.stalled ? "bg-warn" : "animate-pulse bg-accent"}`} aria-hidden />
            {pnl.importProgress.phase === "history" ? "Importing your fee history" : "Re-reading your fee history with the latest importer"}
            <span className="text-ink-soft">· reached {new Date(`${pnl.importProgress.reached}T00:00:00Z`).toLocaleDateString(locale, { month: "short", year: "numeric", timeZone: "UTC" })}</span>
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pnl.importProgress.percent} aria-valuemin={0} aria-valuemax={100}>
              <span className="block h-full rounded-full bg-accent" style={{ width: `${pnl.importProgress.percent}%` }} />
            </span>
            <span className="tabular">{pnl.importProgress.percent}%</span>
            {pnl.importProgress.stalled && <span className="pill-amber inline-flex items-center rounded-full border px-2 py-px text-[11px] font-medium">paused — consl keeps retrying</span>}
          </span>
        )}
        {pnl.importing.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted" title="A freshly connected channel: its orders and money are being read from the platform. Figures fill in as they land.">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
            Importing your {pnl.importing.length > 1 ? `${pnl.importing.slice(0, -1).join(", ")} and ${pnl.importing[pnl.importing.length - 1]}` : pnl.importing[0]} history — figures fill in as it lands.
          </span>
        )}
      </div>

      {!pnl.hasData ? (
        <EmptyState
          icon={PnlFilled}
          title="No ledger data for this period yet"
          body="Amazon's financial events are importing in the background. Fresh fees post within the hour; history fills in window by window."
        />
      ) : periods.length > 0 ? (
        <PnlBreakdownTable pnl={pnl} periods={periods} breakdown={breakdown} money={money} locale={locale} />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="divide-y divide-line">
            {salesBlock && <GroupRow block={salesBlock} money={money} />}
            <CogsRow pnl={pnl} money={money} />
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
            Orders placed that {PNL_CHANNEL_LABEL[p.channel]}{" "}hasn&apos;t posted the money for yet. They already count in this P&amp;L — the sale
            at the order&apos;s price, the fees estimated from your past orders. When {PNL_CHANNEL_LABEL[p.channel]} posts the real money,
            that replaces the estimate.
          </span>
        </div>
      ))}
      {pnl.estimated.units > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <span className="pill-amber inline-flex items-center rounded-full border px-2.5 py-[3px] text-[11px] font-medium">Cost of goods partly estimated</span>
          <span>
            {pnl.estimated.units.toLocaleString()} of the units sold came from {pnl.estimated.lots.length === 1 ? "a lot" : "lots"} not fully costed yet:{" "}
            {pnl.estimated.lots.map((l, i) => (
              <span key={l.id}>
                {i > 0 && ", "}
                <Link href={`/lots/${l.id}`} className="font-medium text-ink-soft underline-offset-2 hover:underline">{l.label}</Link>
              </span>
            ))}
            . They carry the latest paid lot&apos;s cost, or the onboarding cost, until every transaction is in — wait for that before sending this period to your accounting software.
          </span>
        </div>
      )}
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
      {pnl.unplaced.units > 0 && (
        <p className="text-[12px] text-muted">
          {pnl.unplaced.units.toLocaleString()} unit{pnl.unplaced.units === 1 ? "" : "s"} from orders with no facility {pnl.unplaced.units === 1 ? "is" : "are"} priced at
          average cost ({money(Math.abs(pnl.unplaced.cogs))}). Set &ldquo;Fulfilled at&rdquo; on those orders from the Orders tab to price them from real stock.
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
