"use client";

import { useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp } from "@/components/icons";
import { useMoney } from "@/components/CurrencyProvider";
import type { Range } from "@/components/DateRangePicker";
import type { OrdersChart as Chart, OrdersChartPoint } from "@/lib/order-metrics";

/**
 * The Orders tab's header: orders (or units) over the range as bars — grouped by day, week, month
 * or quarter so any range reads cleanly — and, beside them, how the same count splits by channel.
 * Both follow the page's filters. Revenue lives on the P&L, not here.
 */

type Metric = "orders" | "units";

// Bars fade toward the baseline (fill and stroke alike); the peak stays solid.
const FADE = "linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.62) 45%, rgba(0,0,0,0.05) 100%)";
const CHART_H = 220;
// Shades by rank, darkest for the channel with the most, lighter for each smaller one — the same
// three violets on both themes' own tokens (accent-strong, chart, then chart toward white), so the
// order never flips in dark mode. More channels get evenly spaced steps along the same scale.
const LIGHTEST = "color-mix(in srgb, var(--color-chart) 55%, #fff)";
function rankShade(rank: number, count: number): string {
  if (count <= 1) return "var(--color-accent-strong)";
  const t = rank / (count - 1); // 0 = most, 1 = least
  if (t <= 0.5) return `color-mix(in srgb, var(--color-accent-strong) ${Math.round((1 - t * 2) * 100)}%, var(--color-chart))`;
  return `color-mix(in srgb, var(--color-chart) ${Math.round((2 - t * 2) * 100)}%, ${LIGHTEST})`;
}

const day = (s: string) => new Date(`${s}T00:00:00Z`);

/** A round top and step for the y axis: 0, 25, 50, 75, 100 — never a fractional count. */
function scale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const steps = pow >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  const step = Math.max(1, steps.map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow);
  return { top: Math.ceil(max / step) * step, step };
}

export function OrdersChart({ chart, range }: { chart: Chart; range: Range }) {
  const { locale } = useMoney();
  const [metric, setMetric] = useState<Metric>("orders");
  const [hover, setHover] = useState<number | null>(null);

  const num = (n: number) => n.toLocaleString(locale);
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(locale, { ...o, timeZone: "UTC" });
  const { points, bucket } = chart;
  const n = points.length;
  const total = chart.totals[metric];
  const metricLabel = metric === "orders" ? "Orders" : "Units";

  // The peak is the best whole bucket (a partial one can't fairly compete), else the best of any.
  const pool = points.some((p) => !p.partial && p[metric] > 0) ? points.map((p, i) => ({ p, i })).filter(({ p }) => !p.partial) : points.map((p, i) => ({ p, i }));
  const peak = pool.reduce<{ p: OrdersChartPoint; i: number } | null>((best, x) => (!best || x.p[metric] > best.p[metric] ? x : best), null);
  const hasPeak = !!peak && peak.p[metric] > 0;
  const { top, step } = scale(Math.max(0, ...points.map((p) => p[metric])));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step);
  const tick = (t: number) => (t >= 10_000 ? `${(t / 1000).toLocaleString(locale)}k` : num(t));
  const gap = n <= 16 ? 8 : n <= 32 ? 5 : n <= 50 ? 3 : 2;
  const labelEvery = Math.max(1, Math.ceil(n / 6));

  const axisLabel = (p: OrdersChartPoint) =>
    bucket === "month"
      ? `${fmt(day(p.start), { month: "short" })} ’${p.start.slice(2, 4)}`
      : bucket === "quarter"
        ? `Q${Math.floor((Number(p.start.slice(5, 7)) - 1) / 3) + 1} ’${p.start.slice(2, 4)}`
        : fmt(day(p.start), { month: "short", day: "numeric" });
  const spanTitle = (p: OrdersChartPoint) => {
    const a = day(p.start);
    const b = day(p.end);
    if (p.start === p.end) return fmt(a, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    const sameYear = p.start.slice(0, 4) === p.end.slice(0, 4);
    const sameMonth = sameYear && p.start.slice(5, 7) === p.end.slice(5, 7);
    return sameMonth
      ? `${fmt(a, { month: "short", day: "numeric" })} – ${fmt(b, { day: "numeric" })}, ${p.end.slice(0, 4)}`
      : `${fmt(a, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })} – ${fmt(b, { month: "short", day: "numeric", year: "numeric" })}`;
  };
  const tooltipTitle = (p: OrdersChartPoint) => {
    if (p.partial || bucket === "day" || bucket === "week") return spanTitle(p);
    if (bucket === "month") return fmt(day(p.start), { month: "long", year: "numeric" });
    return axisLabel(p).replace("’", "20");
  };
  const peakWhen = (p: OrdersChartPoint) =>
    bucket === "day" ? `on ${axisLabel(p)}` : bucket === "week" ? `in the week of ${axisLabel(p)}` : bucket === "month" ? `in ${fmt(day(p.start), { month: "short", year: "numeric" })}` : `in ${tooltipTitle(p)}`;

  const presets: Record<string, string> = {
    today: "today",
    yesterday: "yesterday",
    "7": "in the last 7 days",
    "30": "in the last 30 days",
    "90": "in the last 90 days",
    "365": "in the last 12 months",
    lastmonth: "last month",
    lastyear: "last year",
    mtd: "this month so far",
    qtd: "this quarter so far",
    ytd: "this year so far",
  };
  const caption =
    range.key === "all"
      ? `${metricLabel}, all time`
      : range.key === "custom"
        ? `${metricLabel} from ${fmt(day(range.from), { month: "short", day: "numeric", year: "numeric" })} to ${fmt(day(range.to), { month: "short", day: "numeric", year: "numeric" })}`
        : `${metricLabel} ${presets[range.key] ?? ""}`.trim();

  // Period over period: the same filters over the equally long stretch just before.
  const prev = chart.previous ? chart.previous[metric] : null;
  const change =
    prev === null ? (
      <span>Since {fmt(day(chart.from), { month: "short", year: "numeric" })}</span>
    ) : prev === 0 ? (
      <span>{total > 0 ? "None" : "No change"} in the previous {chart.previous!.days} days</span>
    ) : (
      (() => {
        const pct = ((total - prev) / prev) * 100;
        const up = pct >= 0;
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className={`flex h-4 w-4 items-center justify-center rounded-full text-white ${up ? "bg-positive" : "bg-negative"}`} aria-hidden>
              {up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
            </span>
            <span className={`tabular ${up ? "text-positive" : "text-negative"}`}>{Math.abs(pct).toLocaleString(locale, { maximumFractionDigits: 1 })}%</span>
            vs the previous {chart.previous!.days} days
          </span>
        );
      })()
    );

  // Channel split: shares of the chosen count; a small channel keeps a readable minimum width.
  const segs = chart.channels
    .map((c) => ({ ...c, value: c[metric], share: total > 0 ? c[metric] / total : 0 }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((c, rank, all) => ({ ...c, color: rankShade(rank, all.length) }));
  const share = (s: number) => (s >= 0.1 ? `${Math.round(s * 100)}%` : `${(s * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`);

  const bar = (p: OrdersChartPoint, i: number) => {
    const v = p[metric];
    const h = top > 0 ? (v / top) * 100 : 0;
    const isPeak = hasPeak && peak!.i === i;
    const style: CSSProperties = { height: `${v > 0 ? Math.max(h, 1.2) : 0}%` };
    if (!isPeak) {
      style.maskImage = FADE;
      style.WebkitMaskImage = FADE;
    }
    const tone = isPeak
      ? "border-chart bg-chart"
      : p.partial
        ? `border-dashed ${hover === i ? "border-chart bg-chart/35" : "border-chart/85 bg-chart/20"}`
        : hover === i
          ? "border-chart bg-chart/50"
          : "border-chart/70 bg-chart/30";
    return (
      <div key={p.start} className="relative flex h-full min-w-0 flex-1 items-end justify-center" onMouseEnter={() => setHover(i)}>
        {hover === i && <span aria-hidden className="absolute inset-0 rounded-md bg-surface-2" />}
        {isPeak && (
          <span
            className="pointer-events-none absolute left-1/2 z-[1] -translate-x-1/2 whitespace-nowrap text-[11.5px] font-medium text-ink"
            style={{ bottom: `calc(${h}% + 7px)` }}
          >
            {axisLabel(p)}
          </span>
        )}
        <span className={`relative w-full max-w-[46px] rounded-t-[6px] border border-b-0 transition-colors ${tone}`} style={style} />
      </div>
    );
  };

  const tip =
    hover !== null && points[hover]
      ? (() => {
          const p = points[hover];
          const running = p.partial && p.end >= new Date().toISOString().slice(0, 10);
          const right = hover < n / 2;
          return (
            <div
              className="pointer-events-none absolute bottom-3 z-10"
              style={{ left: `${((hover + 0.5) / n) * 100}%`, transform: right ? "translateX(14px)" : "translateX(calc(-100% - 14px))" }}
            >
              <div className="flex gap-2.5 rounded-xl border border-border bg-surface px-3 py-2 shadow-lg">
                <span className={`w-[3px] shrink-0 rounded-full ${p.partial ? "bg-chart/50" : "bg-chart"}`} />
                <div className="min-w-[132px]">
                  <div className="whitespace-nowrap text-[12.5px] font-medium text-ink">{tooltipTitle(p)}</div>
                  <div className="mt-1 flex items-baseline justify-between gap-6 text-[12px]">
                    <span className="text-muted">{metricLabel}</span>
                    <span className="tabular font-medium text-ink">{num(p[metric])}</span>
                  </div>
                  {p.partial && <div className="mt-0.5 text-[11px] text-muted">{running ? "So far — still running" : "Part of the period only"}</div>}
                </div>
              </div>
            </div>
          );
        })()
      : null;

  return (
    <section className="grid gap-6 rounded-[var(--radius-card)] border border-border bg-surface p-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-0">
      {/* Bars */}
      <div className="min-w-0 lg:pr-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[30px] font-semibold leading-none tracking-tight text-ink tabular">{num(total)}</div>
            <div className="mt-2 text-[13px] text-muted">{caption}</div>
          </div>
          {n > 0 && (
            <div className="text-right text-[12.5px] text-muted">
              {hasPeak && (
                <div className="border-b border-border pb-1.5">
                  Peak <span className="tabular font-medium text-ink">{num(peak!.p[metric])}</span> {peakWhen(peak!.p)}
                </div>
              )}
              <div className={hasPeak ? "pt-1.5" : ""}>{change}</div>
            </div>
          )}
        </div>

        {n === 0 ? (
          <div className="flex items-center justify-center text-[13px] text-muted" style={{ height: CHART_H + 40 }}>
            No orders match these filters.
          </div>
        ) : (
          <div className="mt-7 flex gap-3" role="img" aria-label={`${caption}: ${num(total)}`}>
            <div className="relative w-9 shrink-0 select-none" style={{ height: CHART_H }}>
              {ticks.map((t) => (
                <span key={t} className="absolute right-0 -translate-y-1/2 text-[11px] tabular text-muted" style={{ top: `${(1 - t / top) * 100}%` }}>
                  {tick(t)}
                </span>
              ))}
            </div>
            <div className="relative min-w-0 flex-1">
              <div className="relative flex items-end" style={{ height: CHART_H, gap }} onMouseLeave={() => setHover(null)}>
                {points.map(bar)}
                {tip}
              </div>
              <div className="relative mt-2 h-4 select-none">
                {points.map((p, i) =>
                  i % labelEvery === 0 ? (
                    <span
                      key={p.start}
                      className="absolute -translate-x-1/2 whitespace-nowrap text-[11.5px] text-muted"
                      style={{ left: `${((i + 0.5) / n) * 100}%` }}
                    >
                      {axisLabel(p)}
                    </span>
                  ) : null,
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Split by channel */}
      <div className="border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-muted">By channel</span>
          <div role="tablist" aria-label="Count" className="flex h-8 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
            {(["orders", "units"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={metric === m}
                onClick={() => setMetric(m)}
                className={`flex h-full items-center rounded-md px-2.5 text-[12px] transition-colors ${metric === m ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink-soft"}`}
              >
                {m === "orders" ? "Orders" : "Units"}
              </button>
            ))}
          </div>
        </div>

        {segs.length === 0 ? (
          <p className="mt-6 text-[13px] text-muted">Nothing to split yet.</p>
        ) : (
          <>
            <div className="mt-8 flex gap-1.5">
              {segs.map((s) => (
                <div key={s.channel} className="min-w-[34px]" style={{ flex: `${s.share} 1 0%` }}>
                  {/* Every segment carries its share and tick; the minimum width keeps a small
                      channel's label clear of its neighbour's. */}
                  <div className="h-10">
                    <span className="block whitespace-nowrap text-[12px] tabular text-muted">{share(s.share)}</span>
                    <span className="mt-1.5 block h-3.5 w-px bg-ink/20" />
                  </div>
                  <div className="h-3.5 rounded-full" style={{ background: s.color }} />
                </div>
              ))}
            </div>
            <ul className="mt-6 flex flex-col gap-3.5">
              {segs.map((s) => (
                <li key={s.channel} className="min-w-0">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                    <span className="min-w-0 flex-1 truncate text-ink">{s.label}</span>
                    <span className="tabular text-ink-soft">{share(s.share)}</span>
                  </div>
                  <div className="mt-0.5 pl-4 text-[12px] tabular text-muted">
                    {num(s.orders)} orders · {num(s.units)} units
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

