"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Settings, RefreshCw } from "@/components/icons";
import { SelectMenu } from "@/components/SelectMenu";
import { HoverHint } from "@/components/HoverHint";
import { DateRangePicker, type Range } from "@/components/DateRangePicker";
import { useMoney } from "@/components/CurrencyProvider";
import { useLtvLiveData } from "@/components/useLtvLiveData";
import { LTV_METRICS, ltvValue, type LtvCell, type LtvCohort, type LtvMetric } from "@/lib/ltv";
import type { LtvPageData } from "@/lib/ltv-data";
import { saveLtvSettings } from "@/app/(app)/ltv/actions";

const button = "inline-flex h-9 items-center justify-center gap-2 rounded-[10px] border border-border bg-surface px-3 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-ink/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-50";

/** One shade per age column, whatever the numbers: super soft on the first order, deepening
 *  column by column to the full accent on the last age shown. A blank cell has no shade. */
function columnStyle(index: number, count: number) {
  const strength = count > 1 ? 6 + (index / (count - 1)) * 94 : 100;
  return {
    backgroundColor: `color-mix(in srgb, var(--ltv-heatmap-color) ${Math.round(strength)}%, var(--color-surface))`,
    color: strength >= 62 ? "var(--color-bg)" : "var(--color-ink)",
  };
}

function cohortLabel(key: string, interval: string, locale: string) {
  if (interval === "year") return key.slice(0, 4);
  if (interval === "quarter") return `Q${Math.ceil(Number(key.slice(5, 7)) / 3)} ${key.slice(0, 4)}`;
  const date = new Date(`${key}T12:00:00Z`);
  return `${interval === "week" ? "Week of " : ""}${date.toLocaleDateString(locale, { month: "short", ...(interval === "week" ? { day: "numeric" as const } : {}), year: "numeric", timeZone: "UTC" })}`;
}

function formatValue(value: number | null, metric: LtvMetric, currency: string, locale: string) {
  if (value === null) return "—";
  const kind = LTV_METRICS.find((m) => m.key === metric)!.format;
  if (kind === "money") return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  if (kind === "percent") return `${value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  return value.toLocaleString(locale, { maximumFractionDigits: kind === "decimal" ? 2 : 0 });
}

export function LtvClient({ data, canEdit }: { data: LtvPageData; canEdit: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const { locale } = useMoney();
  const [pending, startTransition] = useTransition();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { filters, horizons, report } = data;
  const excluded = data.channels.filter((c) => c.excluded);
  const fmt = (cell: LtvCell | null, metric = filters.metric) => formatValue(ltvValue(cell, metric), metric, filters.currency, locale);
  const asOf = new Date(data.asOf).toLocaleDateString(locale, { timeZone: data.timezone, month: "short", day: "numeric", year: "numeric" });
  const metricLabel = !filters.cumulative && filters.metric === "ltv" ? "Revenue per customer" : LTV_METRICS.find((m) => m.key === filters.metric)!.label;

  useLtvLiveData(data.revision);

  function update(changes: Record<string, string | null>) {
    const query = new URLSearchParams(params.toString());
    query.delete("basis");
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    startTransition(() => router.replace(`/ltv?${query}`, { scroll: false }));
  }

  function setRange(range: Range) {
    update({ range: range.key, from: range.key === "custom" ? range.from : null, to: range.key === "custom" ? range.to : null });
  }

  function exportCsv() {
    const value = (cell: LtvCell | null) => ltvValue(cell, filters.metric);
    const rows: Array<Array<string | number | null>> = [
      ["Cohort", "New customers", "Metric", "Revenue definition", "Currency", "View", "Acquired from", "Acquired through", "First order", ...horizons.map((d, i) => filters.cumulative ? `Day ${d}` : `Days ${i ? horizons[i - 1] + 1 : 0}–${d}`)],
      ...report.cohorts.map((c) => [cohortLabel(c.key, filters.interval, locale), c.customers, metricLabel, "Payments after discounts and refunds, including shipping, excluding tax", filters.currency, filters.cumulative ? "Cumulative" : "Per period", filters.from, filters.to, value(c.firstOrder), ...c.cells.map((cell) => (cell?.partial ? `${value(cell)} (so far)` : value(cell)))]),
    ];
    const escape = (v: string | number | null) => `"${String(v ?? "").replace(/^[=+@\t\r]/, "'$&").replace(/"/g, '""')}"`;
    const url = URL.createObjectURL(new Blob(["\uFEFF", rows.map((r) => r.map(escape).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `consl-ltv-${filters.from}-${filters.to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex flex-col gap-5" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={filters.range} onChange={setRange} newest={data.today} oldest={data.oldest} locale={locale} />
          {data.currencies.length > 1 && <SelectMenu value={filters.currency} options={data.currencies.map((c) => ({ value: c, label: c }))} onChange={(currency) => update({ currency })} className="w-24" ariaLabel="Report currency" disabled={pending} />}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={button} aria-expanded={settingsOpen} aria-controls="ltv-settings" onClick={() => setSettingsOpen(!settingsOpen)}>
            <Settings size={15} />Exclude sales channels
            {excluded.length > 0 && <span className="rounded bg-surface-2 px-1.5 text-[11px] text-muted">{excluded.length}</span>}
          </button>
          <button type="button" className={button} disabled={!data.ready || !report.cohorts.length} onClick={exportCsv}><Download size={15} />Export</button>
        </div>
      </div>

      {settingsOpen && <LtvSettings data={data} canEdit={canEdit} onClose={() => setSettingsOpen(false)} />}

      {!data.connected ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center">
          <h2 className="text-base font-medium text-ink">Connect Shopify to see customer lifetime value</h2>
          <p className="mx-auto mt-2 max-w-lg text-[13px] text-muted">Customer cohorts use Shopify customer IDs and your complete order history.</p>
          <Link href="/settings/integrations" className={`${button} mt-5`}>Open integrations</Link>
        </div>
      ) : !data.ready ? (
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-[15px] font-medium text-ink">Preparing your LTV report</h2>
          <p className="mt-2 max-w-2xl text-[13px] text-muted">{data.sync?.error || "We’re preparing LTV from your Shopify orders. Your report will appear automatically when it’s ready."}</p>
          <div role="status" className="mt-4 flex flex-wrap items-center gap-4 text-[12px] text-muted">
            <span>{(data.sync?.orders ?? 0).toLocaleString(locale)} orders checked</span>
            <span className="inline-flex items-center gap-2"><RefreshCw size={14} className={data.sync?.error ? "" : "animate-spin motion-reduce:animate-none"} />{data.sync?.error ? "Checks resume automatically" : "Updating automatically"}</span>
          </div>
          <p className="mt-3 text-[12px] text-muted">You can leave this page. Preparation continues in the background.</p>
        </div>
      ) : (
        <>
          <p className="-mt-2 text-[12px] text-muted">Customers acquired in this date range · purchases tracked through {asOf}</p>
          {data.filterError && <p role="alert" className="text-[13px] text-red-600">{data.filterError}</p>}
          {(report.missingCustomers > 0 || report.excludedCurrency > 0 || data.unenrichedOrders > 0) && (
            <p className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-[12px] text-muted">
              {report.missingCustomers > 0 && `${report.missingCustomers.toLocaleString(locale)} eligible orders without a Shopify customer ID are excluded. `}
              {report.excludedCurrency > 0 && `${report.excludedCurrency.toLocaleString(locale)} orders in other currencies are excluded. `}
              {data.unenrichedOrders > 0 && `${data.unenrichedOrders.toLocaleString(locale)} orders still need LTV data and are excluded.`}
            </p>
          )}

          <section aria-label="Customer overview" className="rounded-[var(--radius-card)] border border-border bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
              <h2 className="text-[13px] font-medium text-ink">Customer overview <span className="ml-2 font-normal text-muted">{filters.currency}</span></h2>
              <p className="text-[11px] text-muted">Customers acquired in the selected dates</p>
            </div>
            <div className="grid grid-cols-2 gap-y-5 px-5 py-6 lg:grid-cols-4">
              <Kpi label="New customers" value={data.kpis.customers.toLocaleString(locale)} hint="Acquired in the date range" />
              <Kpi label="First order AOV" value={fmt(data.kpis.firstOrder, "aov")} hint="Average first purchase" />
              <Kpi label="LTV" value={data.latestLtv ? fmt(data.latestLtv.cell, "ltv") : "—"} hint={data.latestLtv ? `Day ${data.latestLtv.days}, the latest age all customers have closed · ${data.latestLtv.cell.customers.toLocaleString(locale)} customers` : "No age has closed for these customers yet"} />
              <Kpi label="Repeat purchase rate" value={fmt(data.kpis.lifetime, "repeatRate")} hint="2+ purchases over their lifetime" />
            </div>
          </section>

          <section aria-label="Cohort analysis" className="ltv-heatmap overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-[14px] font-medium text-ink">Cohort analysis</h2>
                <p className="mt-1 text-[12px] text-muted">{filters.cumulative ? "Cumulative value" : "Value per period"} since first purchase</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SelectMenu value={filters.metric} options={LTV_METRICS.map((m) => ({ value: m.key, label: !filters.cumulative && m.key === "ltv" ? "Revenue per customer" : m.label }))} onChange={(metric) => update({ metric })} className="w-[215px]" ariaLabel="Cohort metric" disabled={pending} />
                <SelectMenu prefix="Group by" value={filters.interval} options={[{ value: "week", label: "Weekly" }, { value: "month", label: "Monthly" }, { value: "quarter", label: "Quarterly" }, { value: "year", label: "Yearly" }]} onChange={(interval) => update({ interval })} className="w-[168px]" ariaLabel="Group cohorts by" disabled={pending} />
                <SelectMenu value={filters.cumulative ? "1" : "0"} options={[{ value: "1", label: "Cumulative" }, { value: "0", label: "Per period" }]} onChange={(cumulative) => update({ cumulative })} className="w-[142px]" ariaLabel="Cohort view" disabled={pending} />
              </div>
            </div>
            {!report.cohorts.length ? (
              <div className="px-5 py-16 text-center">
                <h3 className="text-[14px] font-medium text-ink">No customers in this view</h3>
                <p className="mt-2 text-[12px] text-muted">Try an earlier acquisition date range or include more sales channels.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse whitespace-nowrap text-[12.5px] tabular-nums">
                    <caption className="sr-only">{`${metricLabel} by acquisition cohort. Each column shows days since first purchase; unavailable periods have not fully matured.`}</caption>
                    <thead>
                      <tr className="border-b border-border text-[11px] text-muted">
                        <th scope="col" className="sticky left-0 z-10 min-w-[150px] bg-surface px-5 py-3.5 text-left font-medium">Cohort</th>
                        <th scope="col" className="px-4 py-3.5 text-right font-medium">Customers</th>
                        <th scope="col" className="px-4 py-3.5 text-right font-medium">First order</th>
                        {horizons.map((d, i) => <th scope="col" key={d} className={`min-w-[94px] px-4 py-3.5 text-right font-medium ${i === horizons.length - 1 ? "pr-5" : ""}`}>{filters.cumulative ? `Day ${d}` : `${i ? horizons[i - 1] + 1 : 0}–${d} days`}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      <CohortRow cohort={report.summary} label="All customers" summary data={data} locale={locale} />
                      {report.cohorts.map((cohort) => <CohortRow key={cohort.key} cohort={cohort} label={cohortLabel(cohort.key, filters.interval, locale)} data={data} locale={locale} />)}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-border px-5 py-3 text-[11px] text-muted">— No customer in this row is that old yet.</div>
              </>
            )}
          </section>

          <div className="flex flex-wrap items-start justify-between gap-3 text-[11.5px] text-muted">
            <details className="max-w-2xl">
              <summary className="cursor-pointer text-ink-soft">How LTV is calculated</summary>
              <div className="mt-3 space-y-2 leading-relaxed">
                <p>Revenue is what customers paid after discounts and refunds, including shipping and excluding tax. LTV divides that revenue by the number of customers in the cohort.</p>
                <p>Cohorts begin with the first paid purchase on an included channel. Excluded-channel orders are ignored completely. Orders are linked by Shopify customer ID. Refunds update the original purchase. Orders that were originally free are always excluded.</p>
                <p>The date range filters when customers were acquired. Their later purchases continue to count. Group by changes how those customers are arranged into rows, based on their first purchase date. Day 30, Day 60 and the other columns always measure time since each customer’s first purchase.</p>
                <p>A cohort’s cell is final when everyone in that row has reached that age. While only its oldest customers have, the cell shows the value so far, in grey with a (!). The All customers row adds up the rows below it, closed cells only, weighted by customers; the LTV figure at the top is the latest age that row has closed.</p>
                <p>{excluded.length ? `Excluded channels: ${excluded.map((c) => c.label).join(", ")}.` : "All discovered sales channels are included."} Times use {data.timezone}.</p>
              </div>
            </details>
            <span>Revenue includes shipping · excludes tax</span>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0 pr-3 even:border-l even:border-border even:pl-5 lg:border-l lg:border-border lg:pl-6 lg:first:border-0 lg:first:pl-0">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-2 text-[28px] font-medium leading-none tracking-tight text-ink tabular-nums">{value}</p>
      <p className="mt-2.5 text-[11.5px] text-muted">{hint}</p>
    </div>
  );
}

function CohortRow({ cohort, label, summary = false, data, locale }: { cohort: LtvCohort; label: string; summary?: boolean; data: LtvPageData; locale: string }) {
  const metric = data.filters.metric;
  const fmt = (cell: LtvCell | null) => formatValue(ltvValue(cell, metric), metric, data.filters.currency, locale);
  const shaded = data.horizons.length + 1; // the first-order column plus every age column
  return (
    <tr className={`border-b border-line last:border-0 ${summary ? "bg-surface-2 font-medium" : "group"}`}>
      <th scope="row" className={`sticky left-0 z-10 px-5 py-3.5 text-left font-medium text-ink ${summary ? "bg-surface-2" : "bg-surface"}`}>{label}</th>
      <td className="px-4 py-3.5 text-right text-muted">{cohort.customers.toLocaleString(locale)}</td>
      <td className="px-4 py-3.5 text-right" style={columnStyle(0, shaded)} title={`${cohort.customers.toLocaleString(locale)} customers · their first order only`}>{fmt(cohort.firstOrder)}</td>
      {cohort.cells.map((cell, i) => {
        const last = i === cohort.cells.length - 1;
        if (cell?.partial) {
          return (
            <td key={data.horizons[i]} className={`px-4 py-3.5 text-right text-muted ${last ? "pr-5" : ""}`} style={{ backgroundColor: "color-mix(in srgb, var(--color-ink) 6%, var(--color-surface))" }}>
              <span className="inline-flex items-center gap-1.5">
                {fmt(cell)}
                <HoverHint title="Still counting" body={`Some of these customers are not ${data.horizons[i]} days old yet. They can still buy again, so this number can still go up. It turns solid once all of them are ${data.horizons[i]} days old. Until then it does not count in the All customers row.`} className="align-middle">
                  <span className="inline-flex h-[15px] w-[15px] cursor-help items-center justify-center rounded-full border border-current text-[10px] font-semibold leading-none">!</span>
                </HoverHint>
              </span>
            </td>
          );
        }
        return (
          <td key={data.horizons[i]} className={`px-4 py-3.5 text-right ${last ? "pr-5" : ""}`} style={cell ? columnStyle(i + 1, shaded) : undefined} title={cell ? `${cell.customers.toLocaleString(locale)} customers · ${cell.orders.toLocaleString(locale)} orders${summary ? ` · the cohorts that have closed ${data.horizons[i]} days` : ""}` : summary ? "No cohort has closed this age yet." : "Nobody in this cohort has reached this age yet."}>
            {fmt(cell)}
          </td>
        );
      })}
    </tr>
  );
}

function LtvSettings({ data, canEdit, onClose }: { data: LtvPageData; canEdit: boolean; onClose: () => void }) {
  const router = useRouter();
  const [overrides, setOverrides] = useState(data.settings.overrides);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    startTransition(async () => { const result = await saveLtvSettings({ overrides }); if (!result.ok) setError(result.error); else { router.refresh(); onClose(); } });
  }
  return <form id="ltv-settings" onSubmit={submit} className="rounded-xl border border-border bg-surface p-5">
    <h2 className="text-[14px] font-medium text-ink">Exclude sales channels</h2><p className="mt-1 text-[12px] text-muted">Orders from checked channels are ignored completely: cohort dates, customer counts, purchases and revenue. This setting is shared by your company and applies only to this report.</p>
    <div className="my-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.channels.map((c) => <label key={c.key} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 text-[13px] text-ink-soft"><input type="checkbox" className="accent-[var(--color-accent)]" disabled={!canEdit || pending} checked={overrides[c.key] ?? c.excluded} onChange={(e) => setOverrides({ ...overrides, [c.key]: e.target.checked })} /><span className="flex-1">{c.label}</span><span className="text-[11px] text-muted">{c.orders.toLocaleString()} orders</span></label>)}</div>
    {!data.channels.length && <p className="my-4 text-[12px] text-muted">Channels appear as order history is imported. Faire and TikTok Shop will be excluded automatically.</p>}
    <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
      <p className="min-w-0 flex-1 text-[12px] text-muted">Free orders ($0), including free samples, are always excluded.</p>
      <div className="ml-auto flex gap-2"><button type="button" className={button} onClick={onClose}>Cancel</button>{canEdit && <button className={`${button} !bg-ink !text-bg`} disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>}</div>
    </div>
    <p className="mt-3 text-[11px] text-muted">Channels come from Shopify’s order history. Subscription orders are grouped under their originating app; renewals use the same Shopify customer ID.</p>
    {!canEdit && <p className="mt-2 text-[12px] text-muted">Ask a company owner or a member with settings access to change these exclusions.</p>}
    {error && <p role="alert" className="mt-3 text-[12px] text-red-600">{error}</p>}
  </form>;
}
