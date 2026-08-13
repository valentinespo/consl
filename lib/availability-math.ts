/**
 * Stock-through-time math for one item at one facility — pure and client-safe, shared by the
 * movement form (calendar locking, per-date caps) and the server action that enforces the same
 * rule on save: a movement can only take what was actually there ON ITS DATE, and can never take
 * units that a later, already-recorded movement carried away.
 */

/** One thing that changed the balance: positive = stock arrived, negative = stock left. */
export type AvailabilityEvent = {
  kind: "FINISHED" | "RAW";
  itemId: string; // productId (finished) | materialTypeId (raw)
  poolSku: string | null; // productId pool for sku-specific raw materials
  facilityId: string;
  date: string; // YYYY-MM-DD
  delta: number;
};

/** End-of-day balances, one point per day that anything happened, ascending. */
export type DayBalance = { date: string; balance: number };

export function buildTimeline(events: { date: string; delta: number }[]): DayBalance[] {
  const byDay = new Map<string, number>();
  for (const e of events) byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.delta);
  const days = [...byDay.keys()].sort();
  let balance = 0;
  const out: DayBalance[] = [];
  for (const d of days) {
    balance += byDay.get(d)!;
    out.push({ date: d, balance });
  }
  return out;
}

/**
 * The most units a NEW movement dated `dateISO` may take: the lowest the balance ever gets from
 * that day onward (a later shipment already claimed its share, so an earlier date can't spend
 * it twice), floored at zero. Same-day arrivals count — end-of-day balances.
 */
export function capOn(timeline: DayBalance[], dateISO: string): number {
  let onDate = 0;
  let minAfter = Infinity;
  for (const p of timeline) {
    if (p.date <= dateISO) onDate = p.balance;
    else minAfter = Math.min(minAfter, p.balance);
  }
  return Math.max(0, Math.min(onDate, minAfter));
}

/** The day stock first existed here, or null if it never did. */
export function firstStockDate(timeline: DayBalance[]): string | null {
  for (const p of timeline) if (p.balance > 1e-9) return p.date;
  return null;
}
