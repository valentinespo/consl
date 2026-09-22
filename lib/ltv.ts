import { channelExcluded, type LtvFacts } from "@/lib/ltv-shopify";

export const LTV_METRICS = [
  { key: "ltv", label: "Lifetime value (LTV)", format: "money" },
  { key: "revenue", label: "Revenue", format: "money" },
  { key: "repeatRate", label: "Repeat purchase rate", format: "percent" },
  { key: "ordersPerCustomer", label: "Orders per customer", format: "decimal" },
  { key: "aov", label: "Average order value", format: "money" },
  { key: "orders", label: "Orders", format: "integer" },
  { key: "returningCustomers", label: "Returning customers", format: "integer" },
] as const;
export type LtvMetric = typeof LTV_METRICS[number]["key"];
export type CohortInterval = "week" | "month" | "quarter" | "year";
export type LtvOrder = {
  id: string;
  customerId: string | null;
  orderedAt: Date;
  cancelled: boolean;
  voided: boolean;
  status: string | null;
  currency: string;
  facts: LtvFacts;
};
export type LtvOptions = {
  from: string;
  to: string;
  asOf: Date;
  timezone: string;
  currency: string;
  interval: CohortInterval;
  horizons: number[];
  cumulative: boolean;
  excludedChannels: Record<string, boolean>;
};
export type LtvCell = {
  customers: number;
  revenue: number;
  orders: number;
  returningCustomers: number;
  /** Not every customer of the row has reached this age yet: the value so far, still moving. */
  partial?: boolean;
};
export type LtvCohort = {
  key: string;
  customers: number;
  firstOrder: LtvCell;
  lifetime: LtvCell;
  cells: Array<LtvCell | null>;
};
export type LtvReport = {
  cohorts: LtvCohort[];
  summary: LtvCohort;
  missingCustomers: number;
  excludedCurrency: number;
};

const DAY = 86_400_000;
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
export function ltvDay(date: Date, timezone: string): string {
  let f = dayFormatters.get(timezone);
  if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }); dayFormatters.set(timezone, f); }
  const parts = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validLtvDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function cohortKey(day: string, interval: CohortInterval): string {
  if (interval === "year") return `${day.slice(0, 4)}-01-01`;
  if (interval === "month") return `${day.slice(0, 7)}-01`;
  if (interval === "quarter") return `${day.slice(0, 4)}-${String(Math.floor((Number(day.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}

export function ltvValue(cell: LtvCell | null, metric: LtvMetric): number | null {
  if (!cell || !cell.customers) return null;
  switch (metric) {
    case "ltv": return cell.revenue / cell.customers;
    case "revenue": return cell.revenue;
    case "repeatRate": return cell.returningCustomers / cell.customers * 100;
    case "ordersPerCustomer": return cell.orders / cell.customers;
    case "aov": return cell.orders ? cell.revenue / cell.orders : null;
    case "orders": return cell.orders;
    case "returningCustomers": return cell.returningCustomers;
  }
}

const emptyCell = (): LtvCell => ({ customers: 0, revenue: 0, orders: 0, returningCustomers: 0 });
function addCell(into: LtvCell, cell: LtvCell) {
  into.customers += cell.customers;
  into.revenue += cell.revenue;
  into.orders += cell.orders;
  into.returningCustomers += cell.returningCustomers;
}

/** Acquisition dates filter CUSTOMERS, never their later purchases. Identify first purchase
 * across all history before applying that range. Unknown customer IDs are never merged into a
 * fictitious guest customer. Refunds restate the value of the original order.
 *
 * An age the OLDEST customer of a row has reached but the youngest hasn't is shown as the value
 * so far — everything the row's customers have spent up to that age, over all of them — marked
 * `partial`: it keeps moving until the whole row is that old. An age nobody in the row has
 * reached is null. The "All customers" row is the rows below it added together: each age column
 * sums exactly the cohorts whose cell is complete at that age (a weighted average by customer
 * count, partial cells left out), and its first-order figures sum every row. `lifetime` is kept
 * for the metrics that need every purchase to date (repeat rate, orders, returning customers).
 */
export function buildLtvReport(orders: LtvOrder[], options: LtvOptions): LtvReport {
  const people = new Map<string, LtvOrder[]>();
  let missingCustomers = 0;
  let excludedCurrency = 0;
  for (const order of orders) {
    // Excluded channels have no effect on acquisition dates, money, counts or diagnostics.
    if (channelExcluded(order.facts.channelKey, order.facts.channelLabel, options.excludedChannels)) continue;
    if (order.cancelled || order.voided || order.facts.test || order.orderedAt > options.asOf) continue;
    if (!order.status || !["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.status)) continue;
    // A fully refunded purchase remains an acquisition. A free order was never a purchase.
    if (order.facts.originalTotal <= 0) continue;
    if (order.currency !== options.currency) { excludedCurrency++; continue; }
    if (!order.customerId) { missingCustomers++; continue; }
    const customer = people.get(order.customerId) ?? [];
    customer.push(order);
    people.set(order.customerId, customer);
  }

  const groups = new Map<string, Array<{ first: LtvOrder; orders: LtvOrder[] }>>();
  for (const customer of people.values()) {
    customer.sort((a, b) => a.orderedAt.getTime() - b.orderedAt.getTime() || a.id.localeCompare(b.id));
    const first = customer[0];
    const day = ltvDay(first.orderedAt, options.timezone);
    if (day < options.from || day > options.to) continue;
    const key = cohortKey(day, options.interval);
    const group = groups.get(key) ?? [];
    group.push({ first, orders: customer });
    groups.set(key, group);
  }

  const revenue = (o: LtvOrder) => o.facts.revenue;
  const cohorts: LtvCohort[] = [];
  for (const [key, people] of groups) {
    const firstOrder = emptyCell();
    const lifetime = emptyCell();
    const cells = options.horizons.map(() => emptyCell());
    const latestFirst = people.reduce((latest, p) => Math.max(latest, p.first.orderedAt.getTime()), 0);
    const earliestFirst = people.reduce((earliest, p) => Math.min(earliest, p.first.orderedAt.getTime()), Infinity);
    for (const person of people) {
      const firstIncluded = person.orders[0];
      addCell(firstOrder, { customers: 1, orders: 1, revenue: revenue(firstIncluded), returningCustomers: 0 });
      addCell(lifetime, { customers: 1, orders: person.orders.length, revenue: person.orders.reduce((s, o) => s + revenue(o), 0), returningCustomers: person.orders.length > 1 ? 1 : 0 });
      options.horizons.forEach((days, i) => {
        const cutoff = person.first.orderedAt.getTime() + days * DAY;
        const lower = !options.cumulative && i > 0 ? person.first.orderedAt.getTime() + options.horizons[i - 1] * DAY : -Infinity;
        const inPeriod = person.orders.filter((o) => o.orderedAt.getTime() <= cutoff && o.orderedAt.getTime() > lower);
        // Deduplicate people within a cell. A third/fourth order never inflates repeat rate.
        const returned = inPeriod.some((o) => o.id !== firstIncluded.id);
        const cell = { customers: 1, orders: inPeriod.length, revenue: inPeriod.reduce((s, o) => s + revenue(o), 0), returningCustomers: returned ? 1 : 0 };
        addCell(cells[i], cell);
      });
    }
    // A cell is final once the whole cohort has reached that age; while only its oldest customers
    // have, it is the value so far (partial); before anyone has, there is nothing to show.
    cohorts.push({
      key,
      customers: people.length,
      firstOrder,
      lifetime,
      cells: cells.map((cell, i) => {
        const age = options.horizons[i] * DAY;
        if (latestFirst + age <= options.asOf.getTime()) return cell;
        if (earliestFirst + age <= options.asOf.getTime()) return { ...cell, partial: true };
        return null;
      }),
    });
  }
  cohorts.sort((a, b) => b.key.localeCompare(a.key));
  const summary: LtvCohort = { key: "All customers", customers: 0, firstOrder: emptyCell(), lifetime: emptyCell(), cells: options.horizons.map(() => null) };
  for (const cohort of cohorts) {
    summary.customers += cohort.customers;
    addCell(summary.firstOrder, cohort.firstOrder);
    addCell(summary.lifetime, cohort.lifetime);
    cohort.cells.forEach((cell, i) => {
      if (!cell || cell.partial) return;
      summary.cells[i] ??= emptyCell();
      addCell(summary.cells[i]!, cell);
    });
  }
  return { cohorts, summary, missingCustomers, excludedCurrency };
}
