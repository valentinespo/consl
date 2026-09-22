import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLtvReport, ltvValue, cohortKey, ltvDay, validLtvDay, type LtvOrder, type LtvOptions } from "./ltv";
import { shopifyLtvFacts, channelExcluded, readLtvFacts, type ShopifyLtvNode } from "./ltv-shopify";

const at = (date: string) => new Date(`${date}T12:00:00Z`);
function order(id: string, customer: string | null, day: string, value: number, channel = "Online Store", extras: Partial<LtvOrder> = {}): LtvOrder {
  return { id, customerId: customer, orderedAt: at(day), cancelled: false, voided: false, status: "PAID", currency: "USD", facts: { version: 2, shop: "example.myshopify.com", channelKey: channel, channelLabel: channel, test: false, revenue: value, originalTotal: value * 1.1 }, ...extras };
}
const options: LtvOptions = { from: "2025-01-01", to: "2025-12-31", asOf: at("2026-09-01"), timezone: "UTC", currency: "USD", interval: "month", horizons: [30, 60, 90, 180, 365], cumulative: true, excludedChannels: {} };

test("later purchases remain included after the acquisition date range", () => {
  const r = buildLtvReport([order("1", "a", "2025-01-01", 40), order("2", "a", "2025-02-10", 60)], { ...options, to: "2025-01-31" });
  assert.equal(r.summary.customers, 1); assert.equal(ltvValue(r.summary.cells[0], "ltv"), 40); assert.equal(ltvValue(r.summary.cells[1], "ltv"), 100);
});
test("history before the range prevents a returning customer becoming new", () => {
  const r = buildLtvReport([order("1", "a", "2024-12-01", 40), order("2", "a", "2025-01-10", 60)], options);
  assert.equal(r.summary.customers, 0);
});
test("Faire and TikTok are excluded, subscription and Shop are included", () => {
  const r = buildLtvReport([order("f", "a", "2025-01-01", 1000, "Faire"), order("t", "b", "2025-01-01", 300, "TikTok Shop"), order("w", "a", "2025-02-01", 50), order("s", "a", "2025-02-10", 50, "Seal Subscriptions"), order("sh", "c", "2025-02-10", 20, "Shop")], options);
  assert.equal(r.cohorts.length, 1); assert.equal(r.cohorts[0].key, "2025-02-01"); assert.equal(r.summary.customers, 2); assert.equal(r.summary.lifetime.revenue, 120);
});
test("explicit inclusion overrides Faire default and exclusions apply to every purchase", () => {
  const orders = [order("1", "a", "2025-01-01", 60), order("2", "a", "2025-02-01", 30, "Faire")];
  assert.equal(buildLtvReport(orders, options).summary.lifetime.orders, 1);
  assert.equal(buildLtvReport(orders, { ...options, excludedChannels: { Faire: false } }).summary.lifetime.orders, 2);
  assert.equal(buildLtvReport(orders, { ...options, excludedChannels: { "Online Store": true } }).summary.customers, 0);
});
test("excluded orders have no effect on any report value, cohort date or maturity", () => {
  const included = [order("1", "a", "2025-03-01", 60), order("2", "a", "2025-04-10", 30), order("3", "b", "2025-03-30", 20)];
  const ignored = [
    order("f1", "a", "2025-01-01", 400, "Faire"),
    order("f2", "b", "2025-02-01", 300, "Faire"),
    order("t1", "a", "2025-03-10", 200, "TikTok Shop"),
    order("t2", "only-excluded", "2025-03-01", 100, "TikTok Shop"),
    order("f3", null, "2025-03-01", 50, "Faire"),
    order("f4", "foreign", "2025-03-01", 50, "Faire", { currency: "CAD" }),
  ];
  for (const cumulative of [true, false]) {
    const view = { ...options, from: "2025-03-01", to: "2025-03-31", asOf: at("2025-04-15"), cumulative };
    const baseline = buildLtvReport(included, view);
    assert.equal(baseline.cohorts[0].key, "2025-03-01");
    assert.equal(baseline.summary.customers, 2);
    assert.equal(baseline.cohorts[0].cells[0], null);
    // The All customers row is the rows below it: a cohort not yet at this age contributes nothing.
    assert.equal(baseline.summary.cells[0], null);
    assert.deepEqual(buildLtvReport([...included, ...ignored], view), baseline);
  }
});
test("excluding an optional channel ignores its first and later purchases completely", () => {
  const paid = order("1", "a", "2025-03-01", 60);
  const view = { ...options, excludedChannels: { "Seal Subscriptions": true } };
  assert.deepEqual(buildLtvReport([
    order("s1", "a", "2025-01-01", 40, "Seal Subscriptions"), paid,
    order("s2", "a", "2025-03-15", 40, "Seal Subscriptions"),
  ], view), buildLtvReport([paid], view));
});
test("missing customer identities are excluded rather than grouped together", () => {
  const r = buildLtvReport([order("1", null, "2025-01-01", 40), order("2", null, "2025-01-02", 60)], options);
  assert.equal(r.missingCustomers, 2); assert.equal(r.summary.customers, 0);
});
test("cancelled, voided, test and unpaid orders do not anchor cohorts", () => {
  const paid = order("5", "a", "2025-02-01", 50);
  const r = buildLtvReport([order("1", "a", "2025-01-01", 100, "Online Store", { cancelled: true }), order("2", "a", "2025-01-01", 100, "Online Store", { voided: true }), order("3", "a", "2025-01-01", 100, "Online Store", { status: "PENDING" }), { ...order("4", "a", "2025-01-01", 100), facts: { ...paid.facts, test: true } }, paid], options);
  assert.equal(r.cohorts[0].key, "2025-02-01"); assert.equal(r.summary.lifetime.orders, 1);
});
test("voided orders are ignored completely and unvoiding restores their contribution", () => {
  const first = order("1", "a", "2025-01-01", 100);
  const next = order("2", "a", "2025-02-01", 50);
  const voided = [
    { ...first, voided: true },
    order("3", "a", "2025-02-10", 200, "Online Store", { voided: true }),
    order("4", "only-voided", "2025-02-01", 300, "Online Store", { voided: true }),
    order("5", null, "2025-02-01", 400, "Online Store", { voided: true }),
    order("6", "foreign", "2025-02-01", 500, "Online Store", { voided: true, currency: "CAD" }),
  ];
  for (const cumulative of [true, false]) {
    const view = { ...options, cumulative };
    assert.deepEqual(buildLtvReport([...voided, next], view), buildLtvReport([next], view));
  }
  const restored = buildLtvReport([first, next, ...voided.slice(1)], options);
  assert.equal(restored.cohorts[0].key, "2025-01-01");
  assert.equal(restored.summary.customers, 1);
  assert.equal(restored.summary.lifetime.revenue, 150);
  assert.equal(restored.summary.lifetime.orders, 2);
  assert.equal(ltvValue(restored.summary.lifetime, "repeatRate"), 100);
});
test("free orders and zero-dollar samples never affect acquisition or repeat purchases", () => {
  const paid = order("2", "a", "2025-02-01", 50);
  const orders = [order("1", "a", "2025-01-01", 0), paid, order("3", "a", "2025-02-10", 0), order("4", "sample-only", "2025-02-01", 0)];
  assert.deepEqual(buildLtvReport(orders, options), buildLtvReport([paid], options));
});
test("refunded paid purchases retain their original cohort", () => {
  const refunded = order("r", "b", "2025-01-01", 100); refunded.status = "REFUNDED"; refunded.facts.revenue = 0;
  const r = buildLtvReport([refunded, order("r2", "b", "2025-02-01", 20)], options);
  assert.equal(r.cohorts[0].key, "2025-01-01"); assert.equal(r.summary.lifetime.orders, 2); assert.equal(r.summary.lifetime.revenue, 20);
});
test("row maturity waits for every customer, and the All customers row follows the completed rows", () => {
  const r = buildLtvReport([order("1", "a", "2025-01-01", 100), order("2", "b", "2025-02-01", 20), order("3", "c", "2025-02-02", 20), order("4", "d", "2025-02-28", 20)], { ...options, asOf: at("2025-03-15") });
  // February's youngest customer is 15 days old: the February row has no Day 30 yet, so only
  // January (1 customer at 100) feeds the All customers Day 30 cell.
  assert.equal(r.cohorts[0].cells[0], null); assert.equal(r.summary.cells[0]?.customers, 1); assert.equal(ltvValue(r.summary.cells[0], "ltv"), 100);
  assert.equal(ltvValue(r.summary.firstOrder, "ltv"), 40); assert.equal(r.summary.cells[2], null);
});
test("grouping changes cohort rows; first order and Lifetime never change, age cells follow the completed rows", () => {
  const orders = [
    order("a1", "a", "2025-01-05", 100), order("a2", "a", "2025-01-20", 50),
    order("b1", "b", "2025-02-02", 20), order("b2", "b", "2025-03-10", 10),
    order("c1", "c", "2025-04-30", 40),
  ];
  for (const cumulative of [true, false]) {
    const view = { ...options, asOf: at("2025-05-15"), cumulative };
    const monthly = buildLtvReport(orders, view);
    for (const interval of ["week", "month", "quarter", "year"] as const) {
      const grouped = buildLtvReport(orders, { ...view, interval });
      assert.deepEqual(grouped.summary.firstOrder, monthly.summary.firstOrder);
      assert.deepEqual(grouped.summary.lifetime, monthly.summary.lifetime);
      assert.equal(grouped.summary.customers, monthly.summary.customers);
      // An age cell of the All customers row sums the rows whose cell is complete, so a wider
      // grouping (a quarter holding a younger customer) can hold that cell back — never overstate it.
      grouped.summary.cells.forEach((cell, i) => { if (cell) assert.ok(cell.customers <= (monthly.summary.cells[i]?.customers ?? Infinity)); });
      assert.equal(grouped.cohorts.reduce((sum, c) => sum + c.customers, 0), 3);
    }
    const quarterly = buildLtvReport(orders, { ...view, interval: "quarter" });
    assert.deepEqual(quarterly.cohorts.map((c) => [c.key, c.customers]), [["2025-04-01", 1], ["2025-01-01", 2]]);
    const yearly = buildLtvReport(orders, { ...view, interval: "year" });
    assert.equal(yearly.cohorts.length, 1);
    // The single yearly row holds a 15-day-old customer, so it has no Day 30 — and neither does
    // the All customers row above it: it only ever adds up the rows below.
    assert.equal(yearly.cohorts[0].cells[0], null);
    assert.equal(yearly.summary.cells[0], null);
    assert.equal(ltvValue(yearly.summary.lifetime, "ltv"), ltvValue(monthly.summary.lifetime, "ltv"));
  }
});
test("quarter, year and week boundaries group acquisition in the Shopify timezone", () => {
  const first = order("1", "a", "2025-04-01", 30, "Online Store", { orderedAt: new Date("2025-04-01T02:00:00Z") });
  const second = order("2", "b", "2025-04-01", 50);
  const quarterly = buildLtvReport([first, second], { ...options, timezone: "America/New_York", interval: "quarter" });
  assert.deepEqual(quarterly.cohorts.map((c) => c.key), ["2025-04-01", "2025-01-01"]);
  assert.equal(cohortKey("2025-12-31", "year"), "2025-01-01");
  assert.equal(cohortKey("2026-01-01", "year"), "2026-01-01");
  assert.equal(cohortKey("2026-01-01", "week"), "2025-12-29");
});
test("repeat customers count once despite many orders", () => {
  const r = buildLtvReport([order("1", "a", "2025-01-01", 20), order("2", "a", "2025-01-02", 20), order("3", "a", "2025-01-03", 20), order("4", "b", "2025-01-04", 20)], options);
  assert.equal(ltvValue(r.summary.cells[0], "repeatRate"), 50); assert.equal(ltvValue(r.summary.cells[0], "ordersPerCustomer"), 2); assert.equal(ltvValue(r.summary.cells[0], "aov"), 20);
});
test("period values use disjoint windows and exact day boundaries", () => {
  const r = buildLtvReport([order("1", "a", "2025-01-01", 20), order("2", "a", "2025-01-31", 30), order("3", "a", "2025-02-01", 40)], { ...options, cumulative: false });
  assert.equal(r.summary.cells[0]?.revenue, 50); assert.equal(r.summary.cells[1]?.revenue, 40); assert.equal(r.summary.cells[2]?.revenue, 0);
  assert.equal(ltvValue(r.summary.cells[1], "repeatRate"), 100); assert.equal(ltvValue(r.summary.cells[2], "aov"), null);
});
test("Shopify timezone and Monday weeks control cohort boundaries", () => {
  assert.equal(ltvDay(new Date("2025-02-01T02:00:00Z"), "America/New_York"), "2025-01-31");
  assert.equal(cohortKey("2025-01-05", "week"), "2024-12-30"); assert.equal(cohortKey("2025-05-20", "quarter"), "2025-04-01");
  assert.equal(validLtvDay("2025-02-30"), false); assert.equal(validLtvDay("2024-02-29"), true);
});
test("different currencies and future purchases never contaminate LTV", () => {
  const r = buildLtvReport([order("1", "a", "2025-01-01", 20), order("2", "b", "2025-01-01", 200, "Online Store", { currency: "CAD" }), order("3", "a", "2027-01-01", 500)], options);
  assert.equal(r.excludedCurrency, 1); assert.equal(r.summary.lifetime.revenue, 20);
});
const money = (amount: number) => ({ shopMoney: { amount: String(amount) } });
// $100 merchandise - $20 discount + $10 shipping + $7 tax = $97 actually paid.
const node: ShopifyLtvNode = { test: false, sourceName: "subscription_contract", app: { id: "gid://shopify/App/123", name: "Seal Subscriptions" }, netPaymentSet: money(97), currentTotalTaxSet: money(7), totalPriceSet: money(97) };
test("LTV includes shipping, excludes tax and never subtracts discounts twice", () => {
  const facts = shopifyLtvFacts(node, "example.myshopify.com")!;
  assert.equal(facts.revenue, 90);
  const r = buildLtvReport([{ ...order("1", "a", "2025-01-01", 0), facts }], options);
  assert.equal(ltvValue(r.summary.cells[0], "ltv"), 90);
  assert.equal(ltvValue(r.summary.firstOrder, "aov"), 90);
  assert.equal(ltvValue(r.summary.lifetime, "revenue"), 90);
});
test("refunds reduce the original purchase once and retain unrefunded shipping", () => {
  // Refunded $40 merchandise and $3.50 tax; the $10 shipping remains.
  assert.equal(shopifyLtvFacts({ ...node, netPaymentSet: money(53.5), currentTotalTaxSet: money(3.5) }, "example.myshopify.com")!.revenue, 50);
  // Goodwill refunds reduce the amount paid even when order line totals did not change.
  assert.equal(shopifyLtvFacts({ ...node, netPaymentSet: money(87) }, "example.myshopify.com")!.revenue, 80);
  // A manual full refund may leave current tax lines unchanged.
  assert.equal(shopifyLtvFacts({ ...node, netPaymentSet: money(0) }, "example.myshopify.com")!.revenue, 0);
});
test("tax-inclusive prices and refunded shipping use the same payment-minus-tax basis", () => {
  const inclusive = { ...node, netPaymentSet: money(110), currentTotalTaxSet: money(10), totalPriceSet: money(110) };
  assert.equal(shopifyLtvFacts(inclusive, "example.myshopify.com")!.revenue, 100);
  assert.equal(shopifyLtvFacts({ ...inclusive, netPaymentSet: money(100), currentTotalTaxSet: money(9.09) }, "example.myshopify.com")!.revenue, 90.91);
});
test("partially paid orders use money received rather than the unpaid order balance", () => {
  assert.equal(shopifyLtvFacts({ ...node, netPaymentSet: money(50) }, "example.myshopify.com")!.revenue, 43);
});
test("one stable app ID unifies Seal first orders and renewals", () => {
  const first = shopifyLtvFacts({ ...node, sourceName: "subscription_contract_checkout_one" }, "example.myshopify.com")!;
  const repeat = shopifyLtvFacts(node, "example.myshopify.com")!;
  assert.equal(first.channelKey, repeat.channelKey);
  assert.equal(channelExcluded(first.channelKey, first.channelLabel, {}), false);
  assert.equal(channelExcluded(first.channelKey, first.channelLabel, { [first.channelKey]: true }), true);
});
test("unenriched and malformed money is missing, never a fake zero", () => {
  assert.equal(shopifyLtvFacts({ ...node, test: undefined }, "example.myshopify.com"), null);
  assert.equal(shopifyLtvFacts({ ...node, totalPriceSet: money(NaN) }, "example.myshopify.com"), null);
  assert.equal(shopifyLtvFacts({ ...node, netPaymentSet: undefined }, "example.myshopify.com"), null);
  assert.equal(shopifyLtvFacts({ ...node, currentTotalTaxSet: money(NaN) }, "example.myshopify.com"), null);
  // Reject the previous shipping-excluded facts, rather than silently reuse them.
  assert.equal(readLtvFacts({ version: 1, shop: "example.myshopify.com", channelKey: "web", channelLabel: "Online Store", test: false, netRevenue: 80, totalRevenue: 97, originalTotal: 97 }), null);
});
test("the All customers row is a customer-weighted sum of the completed cohort cells, and Lifetime is never below a row's last completed age", () => {
  const orders = [
    order("a1", "a", "2025-01-10", 100), order("a2", "a", "2025-03-01", 50),   // January customer, repeat on day 50
    order("b1", "b", "2025-01-20", 20),                                          // January customer
    order("c1", "c", "2025-03-05", 60), order("c2", "c", "2025-03-25", 30),      // March customer, repeat on day 20
  ];
  const r = buildLtvReport(orders, { ...options, from: "2025-01-01", to: "2025-12-31", asOf: at("2025-04-10"), horizons: [30, 60] });
  const jan = r.cohorts.find((c) => c.key === "2025-01-01")!;
  const mar = r.cohorts.find((c) => c.key === "2025-03-01")!;
  assert.equal(ltvValue(jan.cells[0], "ltv"), 60);   // (100 + 20) / 2: nothing within 30 days
  assert.equal(ltvValue(jan.cells[1], "ltv"), 85);   // (150 + 20) / 2
  assert.equal(ltvValue(jan.lifetime, "ltv"), 85);   // = the last completed age: nothing after day 60
  assert.equal(ltvValue(mar.cells[0], "ltv"), 90);   // 60 + 30 within 30 days (the cohort is 36 days old)
  assert.equal(mar.cells[1], null);                  // not 60 days old yet
  assert.equal(ltvValue(mar.lifetime, "ltv"), 90);
  // Day 30 = January (2 customers at 60) + March (1 at 90) = 210 / 3; Day 60 = January only = 85
  assert.equal(r.summary.cells[0]?.customers, 3); assert.equal(ltvValue(r.summary.cells[0], "ltv"), 70);
  assert.equal(r.summary.cells[1]?.customers, 2); assert.equal(ltvValue(r.summary.cells[1], "ltv"), 85);
  assert.equal(ltvValue(r.summary.lifetime, "ltv"), (150 + 20 + 90) / 3);
});

