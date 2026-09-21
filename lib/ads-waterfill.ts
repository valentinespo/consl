/**
 * Amazon ad spend on the statement: the INVOICES are the amount of record, the Ads API's daily
 * spend only gives them their SHAPE in time. No switch date between the two exists, so nothing
 * is lost or counted twice at a seam. Pure functions — no server imports (see the verify script).
 *
 * Amazon bills a seller-payable account every time spend crosses a threshold: an invoice covers
 * the clicks since the previous invoice's cut up to its own, both cuts falling mid-day, so two
 * consecutive invoices share their boundary day (12–14, then 14–16). The money report only says
 * when and how much (one `ProductAdsPayment` per invoice); the Ads API says how much was spent on
 * each calendar day per ad type, for the last two to three months, before click validation.
 *
 * The fill, invoice by invoice in time order, with R(d) = the API's spend on day d minus what
 * earlier invoices already placed there:
 *  1. the period's API-covered days are filled first, in time order, each giving min(R(d), what
 *     is left of the invoice) — a shared day is therefore split between its two invoices, its
 *     total never exceeds the API's figure, and every invoice lands wholly inside its period;
 *  2. what is left goes EVENLY onto the period's days the API does not cover (older than Amazon
 *     keeps, or not read yet) — they are the unknown ones, so they absorb the rest;
 *  3. with no uncovered day to take it, the rest is a surplus (corrections, adjustments) and
 *     lands on the invoice's last day; an invoice smaller than its days' spend (validation took
 *     clicks out) leaves room at the end of its period, which the next invoice fills first;
 *  4. spend on and after the last invoice's cut that no invoice has claimed yet is HELD: shown
 *     as "not invoiced yet" from the API's figures, and replaced by the invoice when it lands.
 * Inside a day, an amount follows the API's split between ad types; a day the API does not
 * cover carries the invoice's own split when Amazon's invoice feed gave it, else "Sponsored ads".
 * What an invoice bills outside the three sponsored ad types (Creator Connections, Amazon Live…)
 * never shows in the API's daily spend, so it goes evenly over the invoice's days under its own
 * name instead of piling up as a surplus.
 *
 * WHICH invoices: see `unifyAdInvoices` — the money report's ad charges plus, from Amazon's
 * invoice feed, whatever was paid some other way; each invoice exactly once.
 */

export type AdInvoice = {
  id: string;
  /** The day the invoice's period ends (its cut) on the ads account's own calendar, YYYY-MM-DD. */
  day: string;
  /** What it charged, positive, in the company's currency. */
  amount: number;
  /** The period's first day when the platform states it; without it the period runs from the
   *  previous invoice's cut (consecutive invoices share their boundary day). */
  from?: string | null;
  /** The invoice's own split by ad program (label → cost), from its detail. */
  mix?: Record<string, number> | null;
};

/** The ad types the Ads API reports daily spend for; anything else an invoice bills is outside it. */
export const API_AD_TYPES = ["Sponsored Products", "Sponsored Brands", "Sponsored Display"];

/** Amazon's program names on an invoice line → the statement's labels. */
export function adProgramLabel(raw: string): string {
  const k = raw.trim().toUpperCase();
  if (k === "SPONSORED PRODUCT" || k === "SPONSORED PRODUCTS") return "Sponsored Products";
  if (k === "SPONSORED BRANDS" || k === "SPONSORED BRAND") return "Sponsored Brands";
  if (k.startsWith("SPONSORED DISPLAY")) return "Sponsored Display";
  if (!k) return UNTYPED_AD_SPEND;
  return k.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/** day → ad type label → spend (positive, company currency). */
export type AdSpendByDay = Map<string, Map<string, number>>;

export type AdFillRow = {
  day: string;
  type: string;
  /** Positive cost. */
  amount: number;
  /** Placed by the API's daily figures (false = an even share on a day the API doesn't cover). */
  shaped: boolean;
  /** Spent per the API but not invoiced yet. */
  held: boolean;
};

export const UNTYPED_AD_SPEND = "Sponsored ads";
export const HELD_SUFFIX = " (not invoiced yet)";

const cents = (n: number) => Math.round(n * 100);
const nextDay = (day: string) => new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

/**
 * The first day the API's figures are COMPLETE from. Amazon keeps each ad type for a different
 * number of days (Sponsored Products the longest), so an early day may carry some ad types only:
 * it would understate that day's spend, and counts as not covered. Only the ad types the account
 * actually spends on decide this — a company that runs Sponsored Products alone gets every day
 * Amazon still has. `coverage` = first covered day per ad type, `used` = ad types with any spend.
 */
export function coveredFromFor(coverage: unknown, used: Iterable<string>, fallback: string | null): string | null {
  const map = coverage && typeof coverage === "object" && !Array.isArray(coverage) ? (coverage as Record<string, unknown>) : {};
  const days = [...new Set(used)].map((k) => map[k]).filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));
  return days.length ? days.sort().at(-1)! : fallback;
}

/** Inclusive [from, to] day ranges, sorted, never touching or overlapping. */
export type DayRanges = [string, string][];
const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Add one range to a list, merging whatever it touches (a range ending the day before another joins it). */
export function addDayRange(ranges: DayRanges, from: string, to: string): DayRanges {
  if (!isDay(from) || !isDay(to) || from > to) return ranges;
  const out: DayRanges = [];
  let cur: [string, string] = [from, to];
  for (const [a, b] of [...ranges].sort((x, y) => x[0].localeCompare(y[0]))) {
    if (nextDay(b) < cur[0]) out.push([a, b]);
    else if (nextDay(cur[1]) < a) {
      out.push(cur);
      cur = [a, b];
    } else cur = [a < cur[0] ? a : cur[0], b > cur[1] ? b : cur[1]];
  }
  out.push(cur);
  return out.sort((x, y) => x[0].localeCompare(y[0]));
}

/** One ad type's covered ranges as stored: a list of ranges, or (before ranges were recorded) its
 *  first covered day alone — which ran unbroken up to `legacyTo`. */
export function dayRangesOf(value: unknown, legacyTo: string | null): DayRanges {
  if (isDay(value)) return legacyTo && value <= legacyTo ? [[value, legacyTo]] : [];
  if (!Array.isArray(value)) return [];
  let out: DayRanges = [];
  for (const r of value) if (Array.isArray(r) && isDay(r[0]) && isDay(r[1])) out = addDayRange(out, r[0], r[1]);
  return out;
}

function intersectDayRanges(a: DayRanges, b: DayRanges): DayRanges {
  const out: DayRanges = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const from = a[i][0] > b[j][0] ? a[i][0] : b[j][0];
    const to = a[i][1] < b[j][1] ? a[i][1] : b[j][1];
    if (from <= to) out.push([from, to]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

/**
 * The days the API's figures are COMPLETE for — as ranges, because a connection that was down
 * for longer than Amazon keeps daily data leaves a hole nothing can ever fill. A day counts only
 * when every ad type the company spends on covers it; a hole's days are simply not covered, so
 * their invoices spread evenly over their own (exact) periods instead of finding "no spend".
 */
export function coveredRangesFor(coverage: unknown, used: Iterable<string>, legacyTo: string | null, fallback: DayRanges): DayRanges {
  const map = coverage && typeof coverage === "object" && !Array.isArray(coverage) ? (coverage as Record<string, unknown>) : {};
  const lists = [...new Set(used)].map((k) => dayRangesOf(map[k], legacyTo)).filter((l) => l.length);
  if (!lists.length) return fallback;
  return lists.reduce((acc, l) => intersectDayRanges(acc, l));
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = nextDay(d)) out.push(d);
  return out;
}

/** Split `total` cents by weights, exactly: the rounding remainder goes to the heaviest part. */
function splitCents(total: number, weights: [string, number][]): [string, number][] {
  const sum = weights.reduce((t, [, w]) => t + w, 0);
  if (total === 0 || sum <= 0) return [];
  const parts = weights.filter(([, w]) => w > 0).map(([k, w]) => [k, Math.floor((total * w) / sum)] as [string, number]);
  let rest = total - parts.reduce((t, [, c]) => t + c, 0);
  const order = [...parts].sort((a, b) => (weights.find(([k]) => k === b[0])![1] - weights.find(([k]) => k === a[0])![1]) || a[0].localeCompare(b[0]));
  for (let i = 0; rest > 0; i = (i + 1) % order.length, rest--) order[i][1] += 1;
  return parts;
}

export type AdFillResult = {
  /** One row per day, ad type and held flag — what the statement books. */
  rows: AdFillRow[];
  /** Per invoice: where its amount went, in cents (for checks and audits). */
  perInvoice: { id: string; from: string; to: string; placed: Map<string, number>; surplus: number }[];
  /** Over the API-covered days up to the last invoice's cut: what the API says vs what invoices placed there. */
  audit: { from: string | null; to: string | null; apiSpend: number; invoiced: number };
};

export function waterfillAdInvoices(input: {
  /** In posting order (oldest first). */
  invoices: AdInvoice[];
  spend: AdSpendByDay;
  /** The days the API's figures are complete for, as ranges (see `coveredRangesFor`)… */
  covered?: DayRanges;
  /** …or one unbroken range: its first and last day; null = no API data at all. */
  coveredFrom?: string | null;
  coveredTo?: string | null;
}): AdFillResult {
  const { invoices, spend } = input;
  const ranges: DayRanges = input.covered ?? (input.coveredFrom && input.coveredTo && input.coveredFrom <= input.coveredTo ? [[input.coveredFrom, input.coveredTo]] : []);
  const covered = (d: string) => ranges.some(([a, b]) => d >= a && d <= b);
  const coveredFrom = ranges.length ? ranges[0][0] : null;
  const coveredTo = ranges.length ? ranges[ranges.length - 1][1] : null;
  const apiCents = (d: string) => [...(spend.get(d)?.values() ?? [])].reduce((t, v) => t + Math.max(0, cents(v)), 0);

  const room = new Map<string, number>(); // R(d), in cents, for covered days
  const roomOf = (d: string) => {
    if (!room.has(d)) room.set(d, covered(d) ? apiCents(d) : 0);
    return room.get(d)!;
  };

  // day|type|held → cents, plus whether it was API-shaped
  const booked = new Map<string, { day: string; type: string; held: boolean; shaped: boolean; cents: number }>();
  const book = (day: string, amount: number, held: boolean, mix?: [string, number][] | null, label?: string) => {
    if (amount <= 0) return;
    const types = covered(day) ? [...(spend.get(day)?.entries() ?? [])].filter(([, v]) => v > 0) : [];
    const pieces: [string, number][] = label
      ? [[label, amount]]
      : types.length
        ? splitCents(amount, types.map(([t, v]) => [t, cents(v)]))
        : mix?.length
          ? splitCents(amount, mix)
          : [[UNTYPED_AD_SPEND, amount]];
    for (const [type, c] of pieces) {
      if (c <= 0) continue;
      const label = held ? `${type}${HELD_SUFFIX}` : type;
      const k = `${day}|${label}`;
      const row = booked.get(k) ?? { day, type: label, held, shaped: covered(day), cents: 0 };
      row.cents += c;
      booked.set(k, row);
    }
  };

  const perInvoice: AdFillResult["perInvoice"] = [];
  let prev: string | null = null;
  for (const inv of invoices) {
    const to = inv.day;
    const from = inv.from && inv.from <= to ? inv.from : prev && prev <= to ? prev : to;
    const days = daysBetween(from, to);
    const total = cents(inv.amount);
    const placed = new Map<string, number>();
    const place = (d: string, c: number) => {
      if (c <= 0) return;
      placed.set(d, (placed.get(d) ?? 0) + c);
    };
    // The invoice's own split, scaled to what it charged (lines exclude adjustments and tax).
    const mixAll = Object.entries(inv.mix ?? {}).filter(([, v]) => v > 0).map(([k, v]) => [k, cents(v)] as [string, number]);
    const scaled = mixAll.length ? splitCents(total, mixAll) : [];
    const inside = scaled.filter(([k]) => API_AD_TYPES.includes(k));
    // 0. what it bills outside the API's ad types: evenly over its days, under its own name
    let left = total;
    for (const [label, c] of scaled.filter(([k]) => !API_AD_TYPES.includes(k))) {
      const share = Math.floor(c / days.length);
      let extra = c - share * days.length;
      for (const d of days) {
        const piece = share + (extra > 0 ? 1 : 0);
        if (extra > 0) extra--;
        place(d, piece);
        book(d, piece, false, null, label);
      }
      left -= c;
    }
    const fill = new Map<string, number>();
    const put = (d: string, c: number) => {
      if (c <= 0) return;
      fill.set(d, (fill.get(d) ?? 0) + c);
      place(d, c);
    };
    // 1. covered days first, in time order
    for (const d of days) {
      if (left <= 0) break;
      if (!covered(d)) continue;
      const take = Math.min(roomOf(d), left);
      if (take > 0) {
        room.set(d, roomOf(d) - take);
        put(d, take);
        left -= take;
      }
    }
    // 2. the rest, evenly over the days the API doesn't cover — 3. or a surplus on the last day
    let surplus = 0;
    if (left > 0) {
      const unknown = days.filter((d) => !covered(d));
      if (unknown.length) {
        const share = Math.floor(left / unknown.length);
        let extra = left - share * unknown.length;
        for (const d of unknown) {
          put(d, share + (extra > 0 ? 1 : 0));
          if (extra > 0) extra--;
        }
      } else {
        surplus = left;
        put(to, left);
      }
      left = 0;
    }
    for (const [d, c] of fill) book(d, c, false, inside.length ? inside : null);
    perInvoice.push({ id: inv.id, from, to, placed, surplus });
    if (!prev || to > prev) prev = to;
  }

  // 4. the held tail: API spend on and after the last cut that no invoice has claimed
  for (const [a, b] of ranges) {
    const start = prev && prev > a ? prev : a;
    if (start <= b) for (const d of daysBetween(start, b)) book(d, roomOf(d), true);
  }

  // The audit compares like with like: covered days strictly before the last cut are final.
  const auditTo = prev && coveredTo ? (prev <= coveredTo ? prev : coveredTo) : null;
  let apiSpend = 0;
  let invoiced = 0;
  if (coveredFrom && auditTo && coveredFrom < auditTo) {
    for (const [a, b] of ranges) for (const d of daysBetween(a, b)) if (d < auditTo) apiSpend += apiCents(d);
    for (const p of perInvoice) for (const [d, c] of p.placed) if (covered(d) && d < auditTo) invoiced += c;
  }

  const rows = [...booked.values()]
    .filter((r) => r.cents > 0)
    .map((r) => ({ day: r.day, type: r.type, amount: r.cents / 100, shaped: r.shaped, held: r.held }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.type.localeCompare(b.type));
  return { rows, perInvoice, audit: { from: coveredFrom && auditTo && coveredFrom < auditTo ? coveredFrom : null, to: auditTo, apiSpend: apiSpend / 100, invoiced: invoiced / 100 } };
}

/**
 * WHICH invoices the statement books — each one exactly once, however it was paid.
 *
 * Two lists describe the same bills. The MONEY REPORT has every ad charge Amazon took out of the
 * seller's balance (one `ProductAdsPayment` per invoice) — and nothing that was paid any other
 * way. Amazon's INVOICE FEED has every invoice whatever the payment method, with its exact period
 * and, in its detail, how it was paid. So:
 *  - money taken from the balance is booked from the money report, always and only — it is the
 *    same ledger the rest of the Amazon statement is built on. The feed invoice it belongs to
 *    (same amount to the cent, invoiced the same day or the day before it posted) only lends it
 *    its exact period and its split by ad program;
 *  - an invoice's money NOT taken from the balance (card, direct debit, bank transfer, prepay) is
 *    booked from the feed — the money report cannot see it.
 * A company that always paid from its balance, one that always paid by card, one that switched
 * once or keeps switching: every invoice falls on one side or the other by its own payment
 * record, so nothing is missed and nothing is counted twice. Until an invoice's detail is read
 * its payment method is unknown: it may still lend its period to a matching charge, but is not
 * booked from the feed (that waits for the detail, minutes later).
 *
 * A WRITE-OFF: Amazon charges an invoice, later writes it off, refunds the very same amount to
 * the balance and usually re-issues the invoice corrected. The charge and its refund cancel each
 * other to the cent, months apart — left as posted they would overstate one month and understate
 * another. Both are taken off the statement together (only once the refund has actually posted);
 * the re-issued invoice is an ordinary invoice and lands on the period the spend happened in.
 */
/** An amount as Amazon stated it, in the ad account's own currency. */
export type NativeAmount = { amount: number; currency: string };

export type LedgerAdCharge = {
  id: string;
  /** Posted day on the ads account's calendar. */
  day: string;
  /** Positive cost, company currency. */
  amount: number;
  /** The same as posted. A charge and its invoice are the same bill when THESE agree to the cent:
   *  converted figures differ by the day's exchange rate (a charge often posts the day after). */
  native?: NativeAmount | null;
};

export type FeedAdInvoice = {
  id: string;
  from: string | null;
  to: string | null;
  invoiceDay: string | null;
  /** Total charged, positive, company currency. */
  amount: number;
  /** The same as invoiced, in the ad account's currency (see LedgerAdCharge.native). */
  native?: NativeAmount | null;
  status: string;
  /** Whether the detail (payments, lines) has been read. */
  detail: boolean;
  /** Of `amount`, what was taken from the seller's balance (succeeded or later refunded there). */
  balancePaid: number;
  mix?: Record<string, number> | null;
};

/** A charge posts the day its invoice is cut, or the next; a week allows for a delayed deduction. */
const MATCH_DAYS_BEFORE = 1;
const MATCH_DAYS_AFTER = 7;
const BOOKABLE = new Set(["ISSUED", "PAID_IN_PART", "PAID_IN_FULL"]);
const dayNumber = (day: string) => Math.round(new Date(`${day}T00:00:00Z`).getTime() / 86_400_000);
/** What two records of the same bill share: the amount as Amazon stated it, currency included. */
const billKey = (x: { amount: number; native?: NativeAmount | null }) => (x.native ? `${x.native.currency}:${cents(x.native.amount)}` : `:${cents(x.amount)}`);

export function unifyAdInvoices(input: {
  ledger: LedgerAdCharge[];
  /** Ad credits in the money report (refunds), amount positive — only used to cancel write-offs. */
  credits?: LedgerAdCharge[];
  feed: FeedAdInvoice[];
  /** The company's first day of Amazon money: invoices that end before it are outside its books. */
  floorDay: string | null;
}): { invoices: AdInvoice[]; matched: number; fromLedgerOnly: number; fromFeed: number; waitingDetail: number; cancelledCreditIds: string[] } {
  const { ledger, feed, floorDay } = input;
  const freeCredits = [...(input.credits ?? [])].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  const cancelledCreditIds: string[] = [];
  // Feed invoices a balance charge may belong to: anything not known to be paid wholly elsewhere.
  const lendable = feed.filter((f) => f.to && f.invoiceDay && f.status !== "ACCUMULATING" && f.status !== "PROCESSING" && (!f.detail || f.balancePaid > 0.004));
  const byCents = new Map<string, FeedAdInvoice[]>();
  for (const f of lendable) {
    const k = billKey(f);
    byCents.set(k, [...(byCents.get(k) ?? []), f]);
  }
  const taken = new Set<string>();
  const invoices: AdInvoice[] = [];
  let matched = 0;
  for (const l of [...ledger].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))) {
    let best: FeedAdInvoice | null = null;
    let bestLag = Infinity;
    for (const f of byCents.get(billKey(l)) ?? []) {
      if (taken.has(f.id)) continue;
      const lag = dayNumber(l.day) - dayNumber(f.invoiceDay!);
      if (lag < -MATCH_DAYS_BEFORE || lag > MATCH_DAYS_AFTER) continue;
      if (Math.abs(lag) < bestLag) {
        best = f;
        bestLag = Math.abs(lag);
      }
    }
    if (best) {
      taken.add(best.id);
      matched++;
      if (best.status === "WRITTEN_OFF") {
        // Refunded to the balance already? Then the charge and its refund leave together.
        const k = freeCredits.findIndex((c) => billKey(c) === billKey(l) && c.day >= l.day);
        if (k >= 0) {
          cancelledCreditIds.push(freeCredits[k].id);
          freeCredits.splice(k, 1);
          continue;
        }
      }
      invoices.push({ id: l.id, day: best.to!, from: best.from, amount: l.amount, mix: best.mix ?? null });
    } else {
      invoices.push({ id: l.id, day: l.day, amount: l.amount });
    }
  }
  let fromFeed = 0;
  let waitingDetail = 0;
  for (const f of feed) {
    if (taken.has(f.id) || !f.to || !BOOKABLE.has(f.status)) continue;
    if (floorDay && f.to < floorDay) continue;
    if (!f.detail) {
      waitingDetail++;
      continue;
    }
    const elsewhere = Math.round((f.amount - f.balancePaid) * 100) / 100;
    if (elsewhere <= 0.004) continue; // balance money: the money report books it when it posts
    fromFeed++;
    invoices.push({ id: f.id, day: f.to, from: f.from, amount: elsewhere, mix: f.mix ?? null });
  }
  invoices.sort((a, b) => a.day.localeCompare(b.day) || (a.from ?? a.day).localeCompare(b.from ?? b.day) || a.id.localeCompare(b.id));
  return { invoices, matched, fromLedgerOnly: ledger.length - matched, fromFeed, waitingDetail, cancelledCreditIds };
}
