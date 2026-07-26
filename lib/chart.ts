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

export type RangeKey = "7" | "30" | "90" | "365" | "mtd" | "qtd" | "ytd" | "all" | "custom";

/** Rail of the date picker. `group` inserts the dividers between families of presets. */
export const RANGES: { key: RangeKey; label: string; days?: number; group: number }[] = [
  { key: "7", label: "Last 7 days", days: 7, group: 0 },
  { key: "30", label: "Last 30 days", days: 30, group: 0 },
  { key: "90", label: "Last 90 days", days: 90, group: 0 },
  { key: "365", label: "Last 12 months", days: 365, group: 0 },
  { key: "mtd", label: "Month to date", group: 1 },
  { key: "qtd", label: "Quarter to date", group: 1 },
  { key: "ytd", label: "Year to date", group: 1 },
  { key: "all", label: "All time", group: 2 },
  { key: "custom", label: "Custom range", group: 3 },
];

/** Shift an ISO day string (YYYY-MM-DD) back by n days, staying in UTC so it can't drift. */
export function shiftDay(day: string, back: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a preset to concrete from/to days, so the calendar can show the same span the chart
 * draws instead of the two disagreeing.
 *
 * Everything is anchored to `newest` — the last day actually recorded — rather than to today. It
 * keeps the result identical on the server and in the browser (no hydration mismatch), and if
 * snapshots ever stall it shows the last N days that exist instead of an empty chart.
 */
export function rangeBounds(
  key: RangeKey,
  newest: string,
  from?: string,
  to?: string,
): { from?: string; to?: string } {
  if (key === "custom") return { from, to };
  if (key === "all") return {};
  const preset = RANGES.find((r) => r.key === key);
  if (preset?.days) return { from: shiftDay(newest, preset.days - 1), to: newest };

  const [y, m] = newest.split("-").map(Number);
  const startMonth = key === "mtd" ? m : key === "qtd" ? Math.floor((m - 1) / 3) * 3 + 1 : 1;
  return { from: `${y}-${String(startMonth).padStart(2, "0")}-01`, to: newest };
}

/** Narrow a day-keyed series to the selected window. */
export function sliceRange<T extends { day: string }>(
  data: T[],
  range: RangeKey,
  from?: string,
  to?: string,
): T[] {
  if (data.length === 0) return data;
  const b = rangeBounds(range, data[data.length - 1].day, from, to);
  if (!b.from && !b.to) return data;
  return data.filter((p) => (!b.from || p.day >= b.from) && (!b.to || p.day <= b.to));
}
