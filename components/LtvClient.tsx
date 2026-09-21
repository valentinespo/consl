"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Card, StatCard } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { LtvFilled } from "@/components/icons";
import { useMoney } from "@/components/CurrencyProvider";
import { ROOT_LOGO } from "@/lib/channel-logos";
import { LTV_HORIZONS, type LtvCell, type LtvHorizon } from "@/lib/ltv";
import type { LtvPayload } from "@/lib/ltv-data";

type Metric = "profit" | "revenue";
const AGE_LABEL: Record<LtvHorizon, string> = { 0: "First order", 30: "30 days", 60: "60 days", 90: "90 days", 180: "180 days", 365: "1 year" };
const CHANNELS = [
  { key: "SHOPIFY", label: "Shopify", enabled: true, hint: "" },
  { key: "AMAZON", label: "Amazon", enabled: false, hint: "Amazon doesn't tell sellers who the buyer is, so its orders can't be grouped by customer." },
  { key: "TIKTOK", label: "TikTok", enabled: false, hint: "Not available yet." },
];

export function LtvClient({ data }: { data: LtvPayload }) {
  const { money, locale } = useMoney();
  const [metric, setMetric] = useState<Metric>("profit");
  const r = data.report;
  const value = (c: LtvCell | undefined) => (c ? c[metric] : null);
  const at = (cells: LtvCell[], h: LtvHorizon) => cells.find((c) => c.horizon === h);
  const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%` : "—");
  const show = (n: number | null | undefined) => (n == null ? "—" : money(n));
  const month = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString(locale, { month: "short", year: "numeric", timeZone: "UTC" });

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Channel" className="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
        {CHANNELS.map((c) => (
          <button key={c.key} type="button" role="radio" aria-checked={c.key === data.channel} disabled={!c.enabled} title={c.hint || undefined}
            className={`flex h-full items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors ${c.key === data.channel ? "bg-surface-2 font-medium text-ink" : "text-muted"} ${c.enabled ? "" : "cursor-not-allowed opacity-50"}`}>
            {ROOT_LOGO[c.key] && <Image src={ROOT_LOGO[c.key]} alt="" width={14} height={14} className="rounded-[3px]" />}
            {c.label}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="Value" className="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
        {([["profit", "Profit"], ["revenue", "Revenue"]] as [Metric, string][]).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={metric === k} onClick={() => setMetric(k)}
            className={`flex h-full items-center rounded-md px-3 text-[12px] transition-colors ${metric === k ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink-soft"}`}>
            {label}
          </button>
        ))}
      </div>
      <span className="text-[12px] text-muted">
        {metric === "profit" ? "After what the units really cost and the order's own fees. Ads are shown apart, as what a new customer cost." : "What customers paid for goods and shipping, after discounts and refunds. Tax left out."}
      </span>
    </div>
  );

  if (!data.connected || !data.customerAccess || r.customers === 0) {
    const [title, body] = !data.connected
      ? ["Connect Shopify to see what a customer is worth", "LTV groups a store's orders by the customer who placed them. Connect your Shopify store and it fills in by itself."]
      : !data.customerAccess
        ? ["This store's connection can't see who the customer is yet", "LTV needs to know which orders belong to the same customer. consl only ever reads Shopify's customer number for that, never a name or an email. It turns on for this store as soon as its connection carries that permission."]
        : ["Reading your orders", "Your store is connected and consl is reading which customer placed each order. This page fills in within a few minutes."];
    return (
      <div className="flex flex-col gap-5">
        {controls}
        <EmptyState icon={LtvFilled} title={title} body={body}>
          {!data.connected && <Link href="/settings/integrations" className="rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white">Open integrations</Link>}
        </EmptyState>
      </div>
    );
  }

  // One shade scale for the whole table: a cell against the biggest value on screen.
  const shown = [...r.cohorts.flatMap((c) => c.cells), ...r.overall].map((x) => value(x)).filter((v): v is number => v != null && v > 0).sort((a, b) => a - b);
  const peak = Math.max(1, shown.length ? shown[Math.min(shown.length - 1, Math.floor(shown.length * 0.9))] : 1);
  const hasAds = r.cohorts.some((c) => c.cac != null);
  const ageCell = (cell: LtvCell | undefined, total: number, key: number, solid = false) => {
    const v = value(cell);
    if (!cell || v == null) return <td key={key} className="px-3 py-2 text-right text-muted">—</td>;
    const strength = Math.max(0, Math.min(1, v / peak));
    return (
      <td key={key} className="px-1 py-1 text-right" title={cell.complete ? `${cell.customers} customers` : `${cell.customers} of ${total} customers are old enough so far; the rest haven't reached ${AGE_LABEL[cell.horizon].toLowerCase()} yet`}>
        <span className={`inline-block w-full rounded-md px-2 py-1 tabular ${v < 0 ? "text-negative" : "text-ink"} ${cell.complete || solid ? "" : "opacity-60"}`} style={{ background: v > 0 ? `color-mix(in srgb, var(--color-accent) ${Math.round(6 + strength * 26)}%, transparent)` : undefined }}>
          {money(v)}
          {!cell.complete && !solid && <span className="ml-1 text-[10px] text-muted">·</span>}
        </span>
      </td>
    );
  };

  const curve = r.overall.filter((c) => value(c) != null) as (LtvCell & { profit: number; revenue: number })[];
  const W = 560, H = 190, PAD = 30;
  const maxV = Math.max(1, ...curve.map((c) => value(c) ?? 0));
  const minV = Math.min(0, ...curve.map((c) => value(c) ?? 0));
  const x = (i: number) => PAD + (curve.length > 1 ? (i / (curve.length - 1)) * (W - PAD * 2) : 0);
  const y = (v: number) => H - PAD - ((v - minV) / (maxV - minV || 1)) * (H - PAD * 2);

  return (
    <div className="flex flex-col gap-5">
      {controls}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Customers" value={r.customers.toLocaleString(locale)} sub={`${r.orders.toLocaleString(locale)} orders since ${r.firstDay ? new Date(`${r.firstDay}T00:00:00Z`).toLocaleDateString(locale, { month: "short", year: "numeric", timeZone: "UTC" }) : "the start"}`} />
        <StatCard label="Came back" value={pct(r.repeaters, r.customers)} sub={`${r.repeaters.toLocaleString(locale)} customers ordered again${r.medianDaysToSecond != null ? ` · typically ${r.medianDaysToSecond} days later` : ""}`} />
        <StatCard label={`${metric === "profit" ? "Profit" : "Revenue"} per customer · 90 days`} value={show(value(at(r.overall, 90)))} sub={`first order ${show(value(at(r.overall, 0)))} · ${at(r.overall, 90)?.customers ?? 0} customers old enough`} accent />
        <StatCard label={`${metric === "profit" ? "Profit" : "Revenue"} per customer · 1 year`} value={show(value(at(r.overall, 365)))} sub={`${at(r.overall, 365)?.customers ?? 0} customers old enough · ${r.ordersPerCustomer} orders each overall`} />
      </div>

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
          <h2 className="text-[15px] font-medium text-ink-soft">By the month of the first order</h2>
          <span className="text-[11.5px] text-muted">Average per customer, adding up from the first order. A dimmed figure with a dot counts only the customers old enough so far.</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className={`w-full text-[12.5px] ${hasAds ? "min-w-[980px]" : "min-w-[760px]"}`}>
            <thead>
              <tr className="border-y border-line text-[11.5px] text-muted">
                <th className="px-5 py-2 text-left font-medium">First order in</th>
                <th className="px-3 py-2 text-right font-medium">New customers</th>
                <th className="px-3 py-2 text-right font-medium">Came back</th>
                {LTV_HORIZONS.map((h) => <th key={h} className="px-3 py-2 text-right font-medium">{AGE_LABEL[h]}</th>)}
                {hasAds && <th className="px-3 py-2 text-right font-medium" title="That month's ad spend on this channel divided by the month's new customers">Ads per new customer</th>}
                {hasAds && <th className="px-5 py-2 text-right font-medium" title="The first age at which the average customer's profit covers what they cost in ads">Paid back by</th>}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line bg-surface-2/50 font-medium">
                <td className="px-5 py-2 text-ink">All customers</td>
                <td className="px-3 py-2 text-right tabular">{r.customers.toLocaleString(locale)}</td>
                <td className="px-3 py-2 text-right tabular">{pct(r.repeaters, r.customers)}</td>
                {LTV_HORIZONS.map((h) => ageCell(at(r.overall, h), r.customers, h, true))}
                {hasAds && <td className="px-3 py-2 text-right text-muted">—</td>}
                {hasAds && <td className="px-5 py-2 text-right text-muted">—</td>}
              </tr>
              {[...r.cohorts].reverse().map((c) => (
                <tr key={c.month} className="border-b border-line last:border-0">
                  <td className="px-5 py-2 text-ink-soft">{month(c.month)}</td>
                  <td className="px-3 py-2 text-right tabular">{c.customers.toLocaleString(locale)}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{pct(c.repeaters, c.customers)}</td>
                  {LTV_HORIZONS.map((h) => ageCell(at(c.cells, h), c.customers, h))}
                  {hasAds && <td className="px-3 py-2 text-right tabular text-ink-soft">{c.cac == null ? "—" : money(c.cac)}</td>}
                  {hasAds && <td className="px-5 py-2 text-right text-ink-soft">{c.cac == null ? "—" : c.paybackDays == null ? <span className="text-muted">not yet</span> : AGE_LABEL[c.paybackDays].toLowerCase()}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Card>
          <h2 className="text-[15px] font-medium text-ink-soft">How a customer&apos;s value builds up</h2>
          <p className="mt-0.5 text-[11.5px] text-muted">Average {metric} per customer by age, over everyone old enough at each age.</p>
          {curve.length > 1 ? (
            <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Value per customer by age">
              <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="var(--color-line)" />
              <polygon fill="var(--color-chart)" opacity={0.1} points={`${x(0)},${y(0)} ${curve.map((c, i) => `${x(i)},${y(value(c) ?? 0)}`).join(" ")} ${x(curve.length - 1)},${y(0)}`} />
              <polyline fill="none" stroke="var(--color-chart)" strokeWidth={2} strokeLinejoin="round" points={curve.map((c, i) => `${x(i)},${y(value(c) ?? 0)}`).join(" ")} />
              {curve.map((c, i) => (
                <g key={c.horizon}>
                  <circle cx={x(i)} cy={y(value(c) ?? 0)} r={3.5} fill="var(--color-chart)" />
                  <text x={x(i)} y={y(value(c) ?? 0) - 9} textAnchor="middle" fontSize={10.5} fill="var(--color-ink-soft)">{money(value(c) ?? 0)}</text>
                  <text x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--color-muted)">{AGE_LABEL[c.horizon]}</text>
                </g>
              ))}
            </svg>
          ) : (
            <p className="mt-6 text-[12.5px] text-muted">Not enough history yet: this fills in as your first customers get older.</p>
          )}
        </Card>

        <Card padded={false} className="overflow-hidden">
          <div className="px-5 pt-4">
            <h2 className="text-[15px] font-medium text-ink-soft">By the first product they bought</h2>
            <p className="mt-0.5 text-[11.5px] text-muted">Which first purchase brings customers who come back and are worth more.</p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-y border-line text-[11.5px] text-muted">
                  <th className="px-5 py-2 text-left font-medium">First product</th>
                  <th className="px-3 py-2 text-right font-medium">Customers</th>
                  <th className="px-3 py-2 text-right font-medium">Came back</th>
                  <th className="px-3 py-2 text-right font-medium">First order</th>
                  <th className="px-3 py-2 text-right font-medium">90 days</th>
                  <th className="px-5 py-2 text-right font-medium">1 year</th>
                </tr>
              </thead>
              <tbody>
                {r.byFirstProduct.map((p) => (
                  <tr key={p.product} className="border-b border-line last:border-0">
                    <td className="max-w-[220px] truncate px-5 py-2 text-ink-soft" title={p.product}>{p.product}</td>
                    <td className="px-3 py-2 text-right tabular">{p.customers.toLocaleString(locale)}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{pct(p.repeaters, p.customers)}</td>
                    {([0, 90, 365] as LtvHorizon[]).map((h, i) => {
                      const cell = at(p.cells, h);
                      const v = value(cell);
                      return <td key={h} className={`${i === 2 ? "px-5" : "px-3"} py-2 text-right tabular ${v == null ? "text-muted" : v < 0 ? "text-negative" : "text-ink"} ${cell && !cell.complete ? "opacity-60" : ""}`} title={cell && v != null ? `${cell.customers} of ${p.customers} customers old enough` : undefined}>{show(v)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {!hasAds && (
        <p className="text-[11.5px] text-muted">No ad spend is counted on this channel, so what a new customer cost in ads isn&apos;t shown. It appears here as soon as an ad platform&apos;s spend counts against Shopify (Settings, Integrations).</p>
      )}
      {data.ordersWithoutCustomer > 0 && (
        <p className="text-[11.5px] text-muted">{data.ordersWithoutCustomer.toLocaleString(locale)} orders carry no customer in Shopify and are left out of this page. They still count on the P&L.</p>
      )}
    </div>
  );
}
