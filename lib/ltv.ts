/**
 * Customer lifetime value, the honest way. Pure functions — no server imports.
 *
 * A customer is whoever the sales channel says placed the order (its own customer id; never an
 * email or a name). Customers are grouped by the MONTH OF THEIR FIRST ORDER (a cohort), and a
 * customer's value is read at fixed ages — the first order, then 30, 60, 90, 180 and 365 days
 * after it — because "lifetime value" with no age attached always flatters old customers: they
 * simply had more time. At each age only customers who have actually REACHED that age count, so
 * a young cohort is never compared at an age it hasn't lived yet; a cell says whether its whole
 * cohort is there (`complete`) or only part of it. The last column, ALL TIME, is the plain
 * lifetime figure people ask for — everything each customer has ordered so far, everyone counted
 * — to be read knowing that older customers have had longer to get there.
 *
 * The page can be narrowed to the customers who FIRST ORDERED inside a date range; whatever they
 * ordered afterwards still counts toward their value, since that is what the value is.
 *
 * Two values per age: REVENUE (what the customer paid for goods and shipping, after discounts and
 * refunds, tax left out) and PROFIT (that revenue minus what the units really cost to make and
 * land, minus the order's own fees) — the same figures, order by order, the P&L is built from.
 * Ad spend belongs to no single order: it shows per cohort as what each NEW customer cost to win
 * (CAC), next to how long that customer took to pay it back.
 */

export const LTV_HORIZONS = [0, 30, 60, 90, 180, 365, "all"] as const;
export type LtvHorizon = (typeof LTV_HORIZONS)[number];

export type LtvOrder = {
  customerId: string;
  /** Ordered instant, ms. */
  at: number;
  /** The same on the company's calendar, YYYY-MM-DD. */
  day: string;
  revenue: number;
  profit: number;
  /** What the order was mostly made of (its biggest line), for "first product bought". */
  product?: string | null;
};

export type LtvCell = {
  horizon: LtvHorizon;
  /** Customers old enough to be read at this age. 0 = nobody yet (revenue/profit null). */
  customers: number;
  /** Every customer of the cohort has reached this age. */
  complete: boolean;
  /** Average cumulative value per customer at this age. */
  revenue: number | null;
  profit: number | null;
};

export type LtvCohort = {
  /** First-order month, YYYY-MM. */
  month: string;
  customers: number;
  /** Customers who ordered again, so far. */
  repeaters: number;
  orders: number;
  cells: LtvCell[];
  /** Ad spend of the month, and per new customer; null when there was none on record. */
  adSpend: number | null;
  cac: number | null;
  /** First age at which the average customer's cumulative PROFIT covers the CAC; null = not yet. */
  paybackDays: LtvHorizon | null;
};

export type LtvProductRow = { product: string; customers: number; repeaters: number; cells: LtvCell[] };

export type LtvReport = {
  customers: number;
  orders: number;
  repeaters: number;
  /** Average order value (revenue) and orders per customer, over everything. */
  aov: number;
  ordersPerCustomer: number;
  /** Days between a repeat customer's first and second order: the median. */
  medianDaysToSecond: number | null;
  /** Everyone, at each age (customers old enough only). */
  overall: LtvCell[];
  cohorts: LtvCohort[];
  /** By the product the FIRST order was mostly made of, biggest groups first. */
  byFirstProduct: LtvProductRow[];
  firstDay: string | null;
  lastDay: string | null;
};

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

type Customer = { id: string; orders: LtvOrder[]; first: LtvOrder };

function cellsFor(customers: Customer[], now: number): LtvCell[] {
  return LTV_HORIZONS.map((horizon) => {
    if (horizon === "all") {
      if (!customers.length) return { horizon, customers: 0, complete: false, revenue: null, profit: null };
      const sum = (pick: (o: LtvOrder) => number) => customers.reduce((t, c) => t + c.orders.reduce((x, o) => x + pick(o), 0), 0);
      return { horizon, customers: customers.length, complete: true, revenue: round2(sum((o) => o.revenue) / customers.length), profit: round2(sum((o) => o.profit) / customers.length) };
    }
    const mature = customers.filter((c) => now - c.first.at >= horizon * DAY_MS);
    if (!mature.length) return { horizon, customers: 0, complete: false, revenue: null, profit: null };
    let revenue = 0;
    let profit = 0;
    for (const c of mature) {
      for (const [i, o] of c.orders.entries()) {
        // Age 0 is the first order alone; a later age is everything ordered up to that many days after it.
        if (horizon === 0 ? i === 0 : o.at - c.first.at <= horizon * DAY_MS) {
          revenue += o.revenue;
          profit += o.profit;
        }
      }
    }
    return { horizon, customers: mature.length, complete: mature.length === customers.length, revenue: round2(revenue / mature.length), profit: round2(profit / mature.length) };
  });
}

export function buildLtvReport(input: {
  orders: LtvOrder[];
  /** Ad spend counted on this channel per month (YYYY-MM → positive amount). */
  adSpendByMonth?: Record<string, number>;
  /** "Now", ms — which ages each customer has reached. */
  now: number;
  /** How many first-product groups to keep. */
  topProducts?: number;
  /** Only customers whose FIRST order falls in this range of company days (inclusive). Their later
   *  orders still count toward their value. */
  firstOrderFrom?: string | null;
  firstOrderTo?: string | null;
}): LtvReport {
  const { orders, now } = input;
  const byCustomer = new Map<string, LtvOrder[]>();
  for (const o of orders) {
    if (!o.customerId) continue;
    byCustomer.set(o.customerId, [...(byCustomer.get(o.customerId) ?? []), o]);
  }
  const everyone: Customer[] = [...byCustomer].map(([id, list]) => {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    return { id, orders: sorted, first: sorted[0] };
  });
  // What a new customer cost is the month's ad spend over ALL of that month's new customers —
  // also when the chosen range only keeps part of the month.
  const newInMonth = new Map<string, number>();
  for (const c of everyone) newInMonth.set(c.first.day.slice(0, 7), (newInMonth.get(c.first.day.slice(0, 7)) ?? 0) + 1);
  const customers = everyone.filter((c) => (!input.firstOrderFrom || c.first.day >= input.firstOrderFrom) && (!input.firstOrderTo || c.first.day <= input.firstOrderTo));

  const counted = customers.reduce((t, c) => t + c.orders.length, 0);
  const revenueAll = customers.reduce((t, c) => t + c.orders.reduce((s, o) => s + o.revenue, 0), 0);
  const repeaters = customers.filter((c) => c.orders.length > 1);
  const gaps = repeaters.map((c) => (c.orders[1].at - c.first.at) / DAY_MS).sort((a, b) => a - b);
  const median = gaps.length ? (gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2) : null;

  const byMonth = new Map<string, Customer[]>();
  for (const c of customers) {
    const m = c.first.day.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), c]);
  }
  const cohorts: LtvCohort[] = [...byMonth]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, list]) => {
      const cells = cellsFor(list, now);
      const spend = input.adSpendByMonth?.[month];
      const adSpend = spend && spend > 0 ? round2(spend) : null;
      const cac = adSpend !== null ? round2(adSpend / (newInMonth.get(month) ?? list.length)) : null;
      const paid = cac === null ? null : cells.find((cell) => cell.profit !== null && cell.profit >= cac);
      return {
        month,
        customers: list.length,
        repeaters: list.filter((c) => c.orders.length > 1).length,
        orders: list.reduce((t, c) => t + c.orders.length, 0),
        cells,
        adSpend,
        cac,
        paybackDays: paid ? paid.horizon : null,
      };
    });

  const byProduct = new Map<string, Customer[]>();
  for (const c of customers) {
    const p = c.first.product?.trim();
    if (p) byProduct.set(p, [...(byProduct.get(p) ?? []), c]);
  }
  const byFirstProduct: LtvProductRow[] = [...byProduct]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, input.topProducts ?? 12)
    .map(([product, list]) => ({ product, customers: list.length, repeaters: list.filter((c) => c.orders.length > 1).length, cells: cellsFor(list, now) }));

  const days = customers.flatMap((c) => c.orders.map((o) => o.day)).sort();
  return {
    customers: customers.length,
    orders: counted,
    repeaters: repeaters.length,
    aov: counted ? round2(revenueAll / counted) : 0,
    ordersPerCustomer: customers.length ? round2(counted / customers.length) : 0,
    medianDaysToSecond: median === null ? null : Math.round(median),
    overall: cellsFor(customers, now),
    cohorts,
    byFirstProduct,
    firstDay: days[0] ?? null,
    lastDay: days.at(-1) ?? null,
  };
}

/** A wholesale marketplace selling through the store (Faire): a retailer buying to resell is not a
 *  consumer, and one pallet-sized order would bend every average on this page. Matched on the
 *  order's source the way channel mirrors are. */
const WHOLESALE_SOURCES = ["faire"];
export const isWholesaleSource = (source: string | null | undefined) => !!source && WHOLESALE_SOURCES.some((k) => source.toLowerCase().includes(k));

/**
 * The orders as shipped to the browser, compact: the page cuts any date range, either value and
 * every table out of them itself, so nothing on it waits for the server. One row per order:
 * [customer index, ordered at (epoch seconds), company day as yyyymmdd, revenue cents, profit
 * cents, product index or -1].
 */
export type LtvWire = { orders: [number, number, number, number, number, number][]; products: string[] };

export function encodeLtvOrders(orders: LtvOrder[]): LtvWire {
  const customers = new Map<string, number>();
  const products = new Map<string, number>();
  const index = (m: Map<string, number>, k: string) => m.get(k) ?? (m.set(k, m.size), m.size - 1);
  return {
    orders: orders.map((o) => [index(customers, o.customerId), Math.round(o.at / 1000), Number(o.day.replaceAll("-", "")), Math.round(o.revenue * 100), Math.round(o.profit * 100), o.product ? index(products, o.product) : -1]),
    products: [...products.keys()],
  };
}

export function decodeLtvOrders(wire: LtvWire): LtvOrder[] {
  return wire.orders.map(([c, at, day, revenue, profit, p]) => {
    const d = String(day);
    return { customerId: `c${c}`, at: at * 1000, day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, revenue: revenue / 100, profit: profit / 100, product: p >= 0 ? wire.products[p] : null };
  });
}

