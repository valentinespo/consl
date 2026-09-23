import { GROUP_ORDER, PNL_CHANNEL_LABEL, PNL_SOURCE_ORDER, sourceBits, sourcesFromBits, type Pnl, type PnlBreakdown, type PnlChannel, type PnlDay, type PnlGroupBlock, type PnlHistory, type PnlPeriod, type PnlPeriodRange, type PnlSource, type PnlStatement } from "@/lib/pnl-shared";

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

type Tally = { units: number; cogs: number };

/** A period's statement from its tallied blocks and costs — the same arithmetic as the Total. */
export function statementFrom(blocks: Blocks, cogs: number, unitsSold: number, mcf: Tally, unreported: Tally): PnlStatement {
  const groups = pnlGroups(blocks);
  const sales = groups.find((group) => group.group === "sales")?.total ?? 0;
  const netProfit = groups.reduce((sum, group) => sum + group.total, 0) + cogs;
  return { groups, sales, cogs, unitsSold, mcf, unreported, netProfit, margin: sales !== 0 ? netProfit / sales : null, roi: cogs !== 0 ? netProfit / Math.abs(cogs) : null };
}

/** Daily statements → compact days (one channel), as the self-check uses them. Empty days are left out. */
export function encodePnlDays(days: PnlPeriod[], channel: PnlChannel = "AMAZON"): PnlDay[] {
  return days
    .map(({ key, statement: s }) => ({
      d: key,
      c: channel,
      rows: s.groups.flatMap((g) => g.types.map((t) => [g.group, t.type, t.amount, sourceBits(t.sources)] as [string, string, number, number])),
      cogs: s.cogs,
      units: s.unitsSold,
      mcf: [s.mcf.units, s.mcf.cogs] as [number, number],
      unreported: [s.unreported.units, s.unreported.cogs] as [number, number],
    }))
    .filter((d) => d.rows.length > 0 || d.units !== 0 || d.cogs !== 0);
}

/** A running fold of compact days: the statement's lines, costs and notes, summed as days come in. */
class DayFold {
  blocks: Blocks = new Map();
  cogs = 0;
  units = 0;
  mcf = { units: 0, cogs: 0 };
  unreported = { units: 0, cogs: 0 };
  estimated = { units: 0, cogs: 0, lots: new Set<string>() };
  preHistoryUnits = 0;
  overflowUnits = 0;
  unplaced = { units: 0, cogs: 0 };
  unmatched = new Set<string>();
  ignored = { skus: new Set<string>(), units: 0, sales: 0 };
  pending = new Map<PnlChannel, number>();
  gap = 0;
  seen = false;

  add(day: PnlDay) {
    this.seen = true;
    for (const [group, type, amount, bits] of day.rows) {
      const sources = sourcesFromBits(bits);
      addPnlAmount(this.blocks, group, type, amount, sources[0] ?? "CONSL");
      for (const source of sources.slice(1)) addPnlAmount(this.blocks, group, type, 0, source);
    }
    this.cogs += day.cogs;
    this.units += day.units;
    this.mcf.units += day.mcf[0];
    this.mcf.cogs += day.mcf[1];
    this.unreported.units += day.unreported[0];
    this.unreported.cogs += day.unreported[1];
    if (day.est) {
      this.estimated.units += day.est[0];
      this.estimated.cogs += day.est[1];
      for (const lot of day.est[2]) this.estimated.lots.add(lot);
    }
    this.preHistoryUnits += day.pre ?? 0;
    this.overflowUnits += day.over ?? 0;
    if (day.unpl) {
      this.unplaced.units += day.unpl[0];
      this.unplaced.cogs += day.unpl[1];
    }
    for (const sku of day.unm ?? []) this.unmatched.add(sku);
    if (day.ign) {
      for (const sku of day.ign[0]) this.ignored.skus.add(sku);
      this.ignored.units += day.ign[1];
      this.ignored.sales += day.ign[2];
    }
    if (day.pend) this.pending.set(day.c, (this.pending.get(day.c) ?? 0) + day.pend);
    this.gap += day.gap ?? 0;
  }

  statement(): PnlStatement {
    return statementFrom(this.blocks, this.cogs, this.units, this.mcf, this.unreported);
  }
}

/** Fold compact days into the given periods (both ascending by day) — the browser-side breakdown. */
export function aggregatePnlDays(days: PnlDay[], ranges: PnlPeriodRange[], channels?: PnlChannel[]): PnlPeriod[] {
  const wanted = channels ? new Set(channels) : null;
  let i = 0;
  return ranges.map((range) => {
    const fold = new DayFold();
    while (i < days.length && days[i].d < range.from) i++;
    for (; i < days.length && days[i].d <= range.to; i++) if (!wanted || wanted.has(days[i].c)) fold.add(days[i]);
    return { ...range, statement: fold.statement() };
  });
}

/**
 * The full statement for a window and a channel mix, cut from the shipped history in the browser
 * — the same figures getPnl computes on the server for that window, notes included.
 */
export function foldPnl(history: PnlHistory, from: string, to: string, channels: PnlChannel[]): Pnl {
  const wanted = new Set(channels);
  const fold = new DayFold();
  for (const day of history.days) {
    if (day.d < from) continue;
    if (day.d > to) break;
    if (wanted.has(day.c)) fold.add(day);
  }
  const s = fold.statement();
  const lotLabel = new Map(history.lots.map((l) => [l.id, l.label]));
  const importing = [
    ...(wanted.has("SHOPIFY") && history.importing.SHOPIFY ? ["Shopify"] : []),
    ...(wanted.has("TIKTOK") && history.importing.TIKTOK ? ["TikTok"] : []),
  ];
  const importProgress = wanted.has("AMAZON") ? history.importProgress : null;
  return {
    ...s,
    adsReconnect: wanted.has("AMAZON") && !!history.adsReconnect,
    pending: history.channels.filter((c) => wanted.has(c) && (fold.pending.get(c) ?? 0) > 0).map((c) => ({ channel: c, sales: fold.pending.get(c)! })),
    unmatchedSkus: [...fold.unmatched].sort(),
    preHistoryUnits: fold.preHistoryUnits,
    overflowUnits: fold.overflowUnits,
    unplaced: fold.unplaced,
    estimated: { units: fold.estimated.units, cogs: fold.estimated.cogs, lots: [...fold.estimated.lots].map((id) => ({ id, label: lotLabel.get(id) ?? id })) },
    ignored: { skus: [...fold.ignored.skus].sort(), units: fold.ignored.units, sales: fold.ignored.sales },
    ledgerGap: Math.round(fold.gap * 100) / 100,
    backfillInProgress: importProgress !== null,
    importProgress,
    importing,
    hasData: s.groups.length > 0 || s.unitsSold > 0,
  };
}

/** The label of every channel in view, for prose. */
export const channelNames = (channels: PnlChannel[]) => channels.map((c) => PNL_CHANNEL_LABEL[c]);

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
      return buckets.map(({ range, blocks, cogs, unitsSold, mcf, unreported }) => ({ ...range, statement: statementFrom(blocks, cogs, unitsSold, mcf, unreported) }));
    },
  };
}
