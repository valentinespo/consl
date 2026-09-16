import { GROUP_ORDER, PNL_SOURCE_ORDER, type PnlBreakdown, type PnlGroupBlock, type PnlPeriod, type PnlPeriodRange, type PnlSource, type PnlStatement } from "@/lib/pnl-shared";

const iso = (date: Date) => date.toISOString().slice(0, 10);
const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);

export function isPnlDay(day: string | undefined): day is string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = dateOf(day);
  return Number.isFinite(date.getTime()) && iso(date) === day;
}

/** Calendar arithmetic stays in UTC; these dates are day labels, not event timestamps. */
export function pnlPeriodRanges(from: string, to: string, breakdown: PnlBreakdown): PnlPeriodRange[] {
  if (breakdown === "none" || !isPnlDay(from) || !isPnlDay(to) || from > to) return [];
  const cursor = dateOf(from);
  if (breakdown === "week") cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());
  if (breakdown === "month" || breakdown === "quarter" || breakdown === "year") cursor.setUTCDate(1);
  if (breakdown === "quarter") cursor.setUTCMonth(Math.floor(cursor.getUTCMonth() / 3) * 3);
  if (breakdown === "year") cursor.setUTCMonth(0);

  const periods: PnlPeriodRange[] = [];
  while (iso(cursor) <= to) {
    const start = iso(cursor);
    if (breakdown === "day" || breakdown === "week") cursor.setUTCDate(cursor.getUTCDate() + (breakdown === "day" ? 1 : 7));
    else cursor.setUTCMonth(cursor.getUTCMonth() + (breakdown === "month" ? 1 : breakdown === "quarter" ? 3 : 12));
    const last = new Date(cursor);
    last.setUTCDate(last.getUTCDate() - 1);
    const end = iso(last);
    periods.push({ key: start, start, end, from: from > start ? from : start, to: to < end ? to : end });
  }
  return periods;
}

export function pnlPeriodHeading(period: PnlPeriodRange, breakdown: PnlBreakdown, locale: string): { label: string; note: string | null } {
  const format = (day: string, options: Intl.DateTimeFormatOptions) => dateOf(day).toLocaleDateString(locale, { ...options, timeZone: "UTC" });
  const shortDay = (day: string) => format(day, { month: "short", day: "numeric", ...(period.from.slice(0, 4) !== period.to.slice(0, 4) ? { year: "numeric" } : {}) });
  const year = period.start.slice(0, 4);
  const label = breakdown === "year" ? year
    : breakdown === "quarter" ? `Q${Math.floor(dateOf(period.start).getUTCMonth() / 3) + 1} ${year}`
    : breakdown === "month" ? format(period.start, { month: "short", year: "numeric" })
    : breakdown === "week" ? `Week of ${format(period.start, { month: "short", day: "numeric", year: "numeric" })}`
    : format(period.start, { month: "short", day: "numeric", year: "numeric" });
  const partial = period.from !== period.start || period.to !== period.end;
  return { label, note: partial ? `Showing ${shortDay(period.from)} – ${shortDay(period.to)}` : null };
}

/** UTC instant of local midnight starting `day` (YYYY-MM-DD) in `tz`, DST-safe. */
export function zonedDayStart(day: string, tz: string): Date {
  const guess = dateOf(day);
  const offsetAt = (at: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(at);
    const m = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour % 24, +m.minute, +m.second) - at.getTime();
  };
  const first = new Date(guess.getTime() - offsetAt(guess));
  return new Date(guess.getTime() - offsetAt(first));
}

/** Inclusive [from-day, to-day] as UTC instants in `tz`. */
export function zonedDayBounds(fromDay: string, toDay: string, tz: string): { from: Date; to: Date } {
  const next = dateOf(toDay);
  next.setUTCDate(next.getUTCDate() + 1);
  return { from: zonedDayStart(fromDay, tz), to: new Date(zonedDayStart(iso(next), tz).getTime() - 1) };
}

type Blocks = Map<string, Map<string, { amount: number; sources: Set<PnlSource> }>>;

export function addPnlAmount(blocks: Blocks, group: string, type: string, amount: number, source: PnlSource) {
  const types = blocks.get(group) ?? new Map();
  const row = types.get(type) ?? { amount: 0, sources: new Set<PnlSource>() };
  row.amount += amount;
  row.sources.add(source);
  types.set(type, row);
  blocks.set(group, types);
}

export function pnlGroups(blocks: Blocks): PnlGroupBlock[] {
  return GROUP_ORDER.map((group) => {
    const types = [...(blocks.get(group) ?? new Map()).entries()]
      .map(([type, row]) => ({ type, amount: row.amount, sources: [...row.sources].sort((a, b) => PNL_SOURCE_ORDER.indexOf(a) - PNL_SOURCE_ORDER.indexOf(b)) }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return { group, total: types.reduce((sum, row) => sum + row.amount, 0), types };
  }).filter((block) => block.types.length > 0);
}

/** Receives the very same ledger amounts and FIFO draws as Total; never replays FIFO per column. */
export function createPnlPeriods(ranges: PnlPeriodRange[], tz: string) {
  const buckets = ranges.map((range) => ({
    range, bounds: zonedDayBounds(range.from, range.to, tz), blocks: new Map() as Blocks,
    cogs: 0, unitsSold: 0, mcf: { units: 0, cogs: 0 }, unreported: { units: 0, cogs: 0 },
  }));
  function bucketAt(at: string | number) {
    let lo = 0, hi = buckets.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const bucket = buckets[mid];
      const before = typeof at === "string" ? at < bucket.range.from : at < bucket.bounds.from.getTime();
      const after = typeof at === "string" ? at > bucket.range.to : at > bucket.bounds.to.getTime();
      if (before) hi = mid - 1;
      else if (after) lo = mid + 1;
      else return bucket;
    }
  }
  return {
    addAmount(at: string | number, group: string, type: string, amount: number, source: PnlSource) {
      const bucket = bucketAt(at);
      if (bucket) addPnlAmount(bucket.blocks, group, type, amount, source);
    },
    addCost(at: number, units: number, cogs: number, mcf = false, unreported = false) {
      const bucket = bucketAt(at);
      if (!bucket) return;
      bucket.unitsSold += units;
      bucket.cogs += cogs;
      if (mcf) { bucket.mcf.units += units; bucket.mcf.cogs += cogs; }
      if (unreported) { bucket.unreported.units += units; bucket.unreported.cogs += cogs; }
    },
    finish(): PnlPeriod[] {
      return buckets.map(({ range, blocks, cogs, unitsSold, mcf, unreported }) => {
        const groups = pnlGroups(blocks);
        const sales = groups.find((group) => group.group === "sales")?.total ?? 0;
        const netProfit = groups.reduce((sum, group) => sum + group.total, 0) + cogs;
        const statement: PnlStatement = { groups, sales, cogs, unitsSold, mcf, unreported, netProfit, margin: sales !== 0 ? netProfit / sales : null, roi: cogs !== 0 ? netProfit / Math.abs(cogs) : null };
        return { ...range, statement };
      });
    },
  };
}
