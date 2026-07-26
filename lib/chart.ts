/** Shared helpers for the dashboard charts. */

/**
 * Round a value range out to human-friendly gridline numbers.
 *
 * Axis labels are only worth putting on screen if they read as round numbers, so the range is
 * widened to the next 1 / 2 / 2.5 / 5 × 10^n step rather than using the raw min and max.
 *
 * The range is deliberately *not* forced down to zero. Inventory value sits in a narrow band well
 * above zero — a zero-based axis would squash every real movement into a flat line. The printed
 * labels are what stop that from being misleading, which is exactly why they're there.
 */
export function niceTicks(min: number, max: number, count = 4): { lo: number; hi: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (min === max) {
    // A flat series still needs a band to draw in, or every point lands on the same pixel.
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const rawStep = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}

/** Short axis label — "$141.2k" rather than "$141,182.83", which never fits in a gutter. */
export function compactMoney(v: number, symbol: string, locale: string): string {
  const abs = Math.abs(v);
  const s = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: abs >= 10_000 ? 1 : 0,
  }).format(v);
  return `${symbol}${s}`;
}

export type RangeKey = "7" | "30" | "90" | "365" | "all" | "custom";

export const RANGES: { key: RangeKey; label: string; days?: number }[] = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "Last 12 months", days: 365 },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom range…" },
];

/** Shift an ISO day string (YYYY-MM-DD) back by n days, staying in UTC so it can't drift. */
export function shiftDay(day: string, back: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/**
 * Narrow a day-keyed series to the selected window.
 *
 * "Last N days" counts back from the newest recorded day rather than from today on purpose: it
 * keeps the result identical on the server and in the browser (no hydration mismatch), and if
 * snapshots ever stall it shows the last N days that actually exist instead of an empty chart.
 */
export function sliceRange<T extends { day: string }>(
  data: T[],
  range: RangeKey,
  from?: string,
  to?: string,
): T[] {
  if (data.length === 0) return data;
  if (range === "custom") {
    if (!from && !to) return data;
    return data.filter((p) => (!from || p.day >= from) && (!to || p.day <= to));
  }
  const days = RANGES.find((r) => r.key === range)?.days;
  if (!days) return data;
  const cutoff = shiftDay(data[data.length - 1].day, days - 1);
  return data.filter((p) => p.day >= cutoff);
}
