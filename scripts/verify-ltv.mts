/** Run with: node --import tsx scripts/verify-ltv.mts */
import assert from "node:assert/strict";
import { buildLtvReport, decodeLtvOrders, encodeLtvOrders, isWholesaleSource, type LtvOrder } from "../lib/ltv.js";

const at = (day: string) => new Date(`${day}T12:00:00Z`).getTime();
const o = (customerId: string, day: string, revenue: number, profit: number, product = "Tea"): LtvOrder => ({ customerId, at: at(day), day, revenue, profit, product });
const cell = (cells: { horizon: number | "all"; revenue: number | null; profit: number | null; customers: number; complete: boolean }[], h: number | "all") => cells.find((c) => c.horizon === h)!;

// Two January customers and one March customer, read on 2026-04-15.
//  anna:  Jan 10 $50 (profit 20), Feb 1 (+22 days) $40 (15), Jun … none
//  bob:   Jan 20 $30 (10) only
//  carl:  Mar 28 $80 (30), Apr 5 (+8 days) $20 (5)
const orders = [o("anna", "2026-01-10", 50, 20, "Tea"), o("anna", "2026-02-01", 40, 15, "Mug"), o("bob", "2026-01-20", 30, 10, "Tea"), o("carl", "2026-03-28", 80, 30, "Kettle"), o("carl", "2026-04-05", 20, 5, "Tea")];
const now = at("2026-04-15");
const r = buildLtvReport({ orders, now, adSpendByMonth: { "2026-01": 40, "2026-03": 100 } });

assert.equal(r.customers, 3);
assert.equal(r.orders, 5);
assert.equal(r.repeaters, 2);
assert.equal(r.ordersPerCustomer, 1.67);
assert.equal(r.aov, 44);
assert.equal(r.medianDaysToSecond, 15); // anna 22 days, carl 8 days

const jan = r.cohorts.find((c) => c.month === "2026-01")!;
assert.deepEqual([jan.customers, jan.repeaters, jan.orders], [2, 1, 3]);
// first order only: (50 + 30) / 2
assert.deepEqual([cell(jan.cells, 0).revenue, cell(jan.cells, 0).profit], [40, 15]);
// by day 30: anna's second order (day 22) is in: (90 + 30) / 2
assert.deepEqual([cell(jan.cells, 30).revenue, cell(jan.cells, 30).profit, cell(jan.cells, 30).complete], [60, 22.5, true]);
// day 90: anna is 95 days old, bob only 85 — only anna counts, and the cell says it is partial
assert.deepEqual([cell(jan.cells, 90).customers, cell(jan.cells, 90).complete, cell(jan.cells, 90).revenue], [1, false, 90]);
// day 180: nobody is that old yet — no number rather than a flattering one
assert.deepEqual([cell(jan.cells, 180).customers, cell(jan.cells, 180).revenue, cell(jan.cells, 180).profit], [0, null, null]);
// CAC: $40 of ads for 2 new customers = $20 each; average profit covers it by day 30 (22.5), not at the first order (15)
assert.deepEqual([jan.adSpend, jan.cac, jan.paybackDays], [40, 20, 30]);

const mar = r.cohorts.find((c) => c.month === "2026-03")!;
assert.deepEqual([cell(mar.cells, 0).revenue, cell(mar.cells, 0).complete], [80, true]);
assert.equal(cell(mar.cells, 30).customers, 0); // carl is 18 days old: his day-30 value is not known yet
assert.deepEqual([mar.cac, mar.paybackDays], [100, null]); // $100 to win him, $30 of profit so far

// overall at day 30: only customers at least 30 days old (anna, bob) — carl does not drag it down
assert.deepEqual([cell(r.overall, 30).customers, cell(r.overall, 30).revenue], [2, 60]);
assert.deepEqual([cell(r.overall, 0).customers, cell(r.overall, 0).revenue], [3, 53.33]);

// by the product of the FIRST order
assert.deepEqual(r.byFirstProduct.map((p) => [p.product, p.customers, p.repeaters]), [["Tea", 2, 1], ["Kettle", 1, 1]]);
assert.deepEqual([r.firstDay, r.lastDay], ["2026-01-10", "2026-04-05"]);

// a refund makes an order's revenue negative-leaning but never breaks the averages; no ad spend → no CAC
const r2 = buildLtvReport({ orders: [o("x", "2026-01-01", 0, -4)], now: at("2026-03-01") });
assert.deepEqual([cell(r2.overall, 30).revenue, cell(r2.overall, 30).profit, r2.cohorts[0].cac, r2.cohorts[0].paybackDays], [0, -4, null, null]);
assert.equal(buildLtvReport({ orders: [], now }).customers, 0);

// ALL TIME: everything each customer has ordered so far, everyone counted, never partial.
assert.deepEqual([cell(jan.cells, "all").revenue, cell(jan.cells, "all").profit, cell(jan.cells, "all").customers, cell(jan.cells, "all").complete], [60, 22.5, 2, true]);
assert.deepEqual([cell(mar.cells, "all").revenue, cell(mar.cells, "all").profit], [100, 35]);
assert.deepEqual([cell(r.overall, "all").revenue, cell(r.overall, "all").customers], [73.33, 3]);

// A date range keeps the customers who FIRST ordered inside it — and everything they ordered
// afterwards still counts (anna's February order is part of a January customer's value).
const janOnly = buildLtvReport({ orders, now, firstOrderFrom: "2026-01-01", firstOrderTo: "2026-01-31" });
assert.deepEqual([janOnly.customers, janOnly.orders, janOnly.repeaters, janOnly.cohorts.length], [2, 3, 1, 1]);
assert.equal(cell(janOnly.overall, "all").revenue, 60);
// …and a customer is never "new" in a later range just because they ordered again in it
const febOnly = buildLtvReport({ orders, now, firstOrderFrom: "2026-02-01", firstOrderTo: "2026-02-28" });
assert.equal(febOnly.customers, 0);
assert.deepEqual([febOnly.firstDay, cell(febOnly.overall, "all").revenue], [null, null]);

// The compact form the page receives gives back the very same report.
const round = buildLtvReport({ orders: decodeLtvOrders(encodeLtvOrders(orders)), now, adSpendByMonth: { "2026-01": 40, "2026-03": 100 } });
assert.deepEqual(round.cohorts, r.cohorts);
assert.deepEqual(round.overall, r.overall);
assert.deepEqual(round.byFirstProduct, r.byFirstProduct);

assert.deepEqual([isWholesaleSource("faire"), isWholesaleSource("Faire Wholesale"), isWholesaleSource("web"), isWholesaleSource(null)], [true, true, false, false]);

console.log("ltv: all checks passed");
