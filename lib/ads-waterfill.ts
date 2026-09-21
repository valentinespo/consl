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
 * cover carries the plain "Sponsored ads".
 */

export type AdInvoice = {
  id: string;
  /** The invoice's posted day on the ads account's own calendar, YYYY-MM-DD. */
  day: string;
  /** What it charged, positive, in the company's currency. */
  amount: number;
};

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
  /** First and last day the API's figures are complete for; null = no API data at all. */
  coveredFrom: string | null;
  coveredTo: string | null;
}): AdFillResult {
  const { invoices, spend, coveredFrom, coveredTo } = input;
  const covered = (d: string) => !!coveredFrom && !!coveredTo && d >= coveredFrom && d <= coveredTo;
  const apiCents = (d: string) => [...(spend.get(d)?.values() ?? [])].reduce((t, v) => t + Math.max(0, cents(v)), 0);

  const room = new Map<string, number>(); // R(d), in cents, for covered days
  const roomOf = (d: string) => {
    if (!room.has(d)) room.set(d, covered(d) ? apiCents(d) : 0);
    return room.get(d)!;
  };

  // day|type|held → cents, plus whether it was API-shaped
  const booked = new Map<string, { day: string; type: string; held: boolean; shaped: boolean; cents: number }>();
  const book = (day: string, amount: number, held: boolean) => {
    if (amount <= 0) return;
    const types = covered(day) ? [...(spend.get(day)?.entries() ?? [])].filter(([, v]) => v > 0) : [];
    const pieces: [string, number][] = types.length ? splitCents(amount, types.map(([t, v]) => [t, cents(v)])) : [[UNTYPED_AD_SPEND, amount]];
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
    const from = prev && prev <= to ? prev : to;
    const days = daysBetween(from, to);
    let left = cents(inv.amount);
    const placed = new Map<string, number>();
    const place = (d: string, c: number) => {
      if (c <= 0) return;
      placed.set(d, (placed.get(d) ?? 0) + c);
    };
    // 1. covered days first, in time order
    for (const d of days) {
      if (left <= 0) break;
      if (!covered(d)) continue;
      const take = Math.min(roomOf(d), left);
      if (take > 0) {
        room.set(d, roomOf(d) - take);
        place(d, take);
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
          place(d, share + (extra > 0 ? 1 : 0));
          if (extra > 0) extra--;
        }
      } else {
        surplus = left;
        place(to, left);
      }
      left = 0;
    }
    for (const [d, c] of placed) book(d, c, false);
    perInvoice.push({ id: inv.id, from, to, placed, surplus });
    prev = to;
  }

  // 4. the held tail: API spend on and after the last cut that no invoice has claimed
  if (coveredFrom && coveredTo) {
    const start = prev && prev > coveredFrom ? prev : coveredFrom;
    for (const d of daysBetween(start, coveredTo)) book(d, roomOf(d), true);
  }

  // The audit compares like with like: covered days strictly before the last cut are final.
  const auditTo = prev && coveredTo ? (prev <= coveredTo ? prev : coveredTo) : null;
  let apiSpend = 0;
  let invoiced = 0;
  if (coveredFrom && auditTo && coveredFrom < auditTo) {
    for (const d of daysBetween(coveredFrom, auditTo)) {
      if (d === auditTo) break;
      apiSpend += apiCents(d);
    }
    for (const p of perInvoice) for (const [d, c] of p.placed) if (d >= coveredFrom && d < auditTo) invoiced += c;
  }

  const rows = [...booked.values()]
    .filter((r) => r.cents > 0)
    .map((r) => ({ day: r.day, type: r.type, amount: r.cents / 100, shaped: r.shaped, held: r.held }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.type.localeCompare(b.type));
  return { rows, perInvoice, audit: { from: coveredFrom && auditTo && coveredFrom < auditTo ? coveredFrom : null, to: auditTo, apiSpend: apiSpend / 100, invoiced: invoiced / 100 } };
}
