/** Run with: node --import tsx scripts/verify-pnl-periods.mts */
import assert from "node:assert/strict";
import { aggregatePnlDays, createPnlPeriods, encodePnlDays, isPnlDay, pnlPeriodHeading, pnlPeriodRanges, zonedDayBounds } from "../lib/pnl-periods.js";
import { parsePnlBreakdown, type PnlBreakdown } from "../lib/pnl-shared.js";

assert.equal(parsePnlBreakdown(undefined), "none");
assert.equal(parsePnlBreakdown("invalid"), "none");
assert.deepEqual(pnlPeriodRanges("2026-01-01", "2026-09-16", "none"), []);
assert.equal(isPnlDay("2026-02-29"), false);
assert.equal(isPnlDay("2024-02-29"), true);
assert.deepEqual(pnlPeriodRanges("2026-03-25", "2026-03-01", "day"), []);

const annual = pnlPeriodRanges("2026-03-01", "2026-03-25", "year");
assert.equal(annual.length, 1);
assert.deepEqual(pnlPeriodHeading(annual[0], "year", "en-US"), { label: "2026", note: "Showing Mar 1 – Mar 25" });
const months = pnlPeriodRanges("2026-01-01", "2026-09-16", "month");
assert.equal(months.length, 9);
for (const month of months.slice(0, 8)) assert.equal(pnlPeriodHeading(month, "month", "en-US").note, null);
assert.deepEqual(pnlPeriodHeading(months[8], "month", "en-US"), { label: "Sep 2026", note: "Showing Sep 1 – Sep 16" });
const partialFirst = pnlPeriodRanges("2026-01-15", "2026-03-31", "month");
assert.equal(pnlPeriodHeading(partialFirst[0], "month", "en-US").note, "Showing Jan 15 – Jan 31");
assert.equal(pnlPeriodHeading(partialFirst[2], "month", "en-US").note, null);
const quarters = pnlPeriodRanges("2025-12-15", "2026-04-03", "quarter");
assert.deepEqual(quarters.map((period) => pnlPeriodHeading(period, "quarter", "en-US").label), ["Q4 2025", "Q1 2026", "Q2 2026"]);
assert.equal(pnlPeriodHeading(quarters[1], "quarter", "en-US").note, null);
const weeks = pnlPeriodRanges("2025-12-31", "2026-01-12", "week");
assert.deepEqual(weeks.map(({ start, end }) => [start, end]), [["2025-12-28", "2026-01-03"], ["2026-01-04", "2026-01-10"], ["2026-01-11", "2026-01-17"]]);
assert.equal(pnlPeriodHeading(weeks[0], "week", "en-US").note, "Showing Dec 31, 2025 – Jan 3, 2026");
assert.equal(pnlPeriodHeading(weeks[1], "week", "en-US").note, null);
assert.equal(pnlPeriodRanges("2024-02-28", "2024-03-01", "day").length, 3);

// Every day is covered once, including leap days, year transitions and clipped end periods.
for (const breakdown of ["day", "week", "month", "quarter", "year"] as PnlBreakdown[]) {
  const ranges = pnlPeriodRanges("2023-12-29", "2026-09-16", breakdown);
  assert.equal(ranges[0].from, "2023-12-29");
  assert.equal(ranges.at(-1)!.to, "2026-09-16");
  for (let i = 1; i < ranges.length; i++) {
    assert.equal(Date.parse(ranges[i].from) - Date.parse(ranges[i - 1].to), 86_400_000);
  }
}

// Company days can be 23 or 25 hours. Midnight belongs only to the new day.
for (const [day, hours] of [["2026-03-08", 23], ["2026-11-01", 25]] as const) {
  const bounds = zonedDayBounds(day, day, "America/Los_Angeles");
  assert.equal(bounds.to.getTime() - bounds.from.getTime() + 1, hours * 3_600_000);
}
const daily = createPnlPeriods(pnlPeriodRanges("2026-03-07", "2026-03-09", "day"), "America/Los_Angeles");
const instant = (value: string) => Date.parse(value);
daily.addAmount(instant("2026-03-08T07:59:59.999Z"), "sales", "Principal", 100, "AMAZON");
daily.addAmount(instant("2026-03-08T08:00:00Z"), "sales", "Principal", 200, "AMAZON");
daily.addAmount("2026-03-08", "sales", "Principal", 300, "SHOPIFY");
daily.addAmount(instant("2026-03-09T06:59:59.999Z"), "custom_fees", "Packing", -25, "CUSTOM");
daily.addAmount(instant("2026-03-09T07:00:00Z"), "refunds", "Refund", -50, "TIKTOK");
daily.addAmount(instant("2026-03-10T07:00:00Z"), "sales", "Outside the range", 999, "AMAZON");
daily.addCost(instant("2026-03-08T07:59:59.999Z"), 1, -20);
daily.addCost(instant("2026-03-08T08:00:00Z"), 3, -60, true);
daily.addCost(instant("2026-03-09T07:00:00Z"), 2, -40, false, true);
const dailyStatements = daily.finish().map((period) => period.statement);
assert.deepEqual(dailyStatements.map((statement) => statement.sales), [100, 500, 0]);
assert.deepEqual(dailyStatements.map((statement) => statement.cogs), [-20, -60, -40]);
assert.deepEqual(dailyStatements.map((statement) => statement.netProfit), [80, 415, -90]);
assert.deepEqual(dailyStatements[1].groups[0].types[0].sources, ["AMAZON", "SHOPIFY"]);
assert.deepEqual(dailyStatements[1].mcf, { units: 3, cogs: -60 });
assert.deepEqual(dailyStatements[2].unreported, { units: 2, cogs: -40 });
assert.equal(dailyStatements[1].margin, 415 / 500);
assert.equal(dailyStatements[1].roi, 415 / 60);
assert.equal(dailyStatements[2].margin, null);

// Positive-offset timezones put late UTC events into the next company day.
const tokyo = createPnlPeriods(pnlPeriodRanges("2026-01-01", "2026-01-02", "day"), "Asia/Tokyo");
tokyo.addAmount(instant("2026-01-01T15:00:00Z"), "sales", "Principal", 10, "AMAZON");
assert.deepEqual(tokyo.finish().map((period) => period.statement.sales), [0, 10]);
const empty = createPnlPeriods(pnlPeriodRanges("2026-01-01", "2026-03-31", "month"), "UTC").finish();
assert.equal(empty.length, 3);
assert.ok(empty.every(({ statement }) => statement.netProfit === 0 && statement.margin === null && statement.roi === null));
// The browser folds compact days into any breakdown and lands on the same statements the server
// would have bucketed directly — amounts, sources, costs, units and ratios alike.
{
  const dayRanges = pnlPeriodRanges("2026-01-28", "2026-03-03", "day");
  const direct = createPnlPeriods(pnlPeriodRanges("2026-01-28", "2026-03-03", "month"), "UTC");
  const directYear = createPnlPeriods(pnlPeriodRanges("2026-01-28", "2026-03-03", "year"), "UTC");
  const perDay = createPnlPeriods(dayRanges, "UTC");
  const events: [string, string, string, number, string][] = [
    ["2026-01-28T10:00:00Z", "sales", "Principal", 100, "AMAZON"], ["2026-01-31T23:59:00Z", "sales", "Principal", 50, "SHOPIFY"],
    ["2026-02-01T00:00:00Z", "sales", "Principal", 75, "AMAZON"], ["2026-02-14T12:00:00Z", "fba_fees", "FBAPerUnitFulfillmentFee", -12.5, "AMAZON"],
    ["2026-02-20T12:00:00Z", "refunds", "Refund", -30, "AMAZON"], ["2026-03-03T08:00:00Z", "sales", "Principal", 20, "TIKTOK"],
  ];
  for (const [at, group, type, amount, source] of events) for (const b of [direct, directYear, perDay]) b.addAmount(Date.parse(at), group, type, amount, source as never);
  for (const [at, units, cogs, mcf, unreported] of [["2026-01-29T00:00:00Z", 2, -40, false, false], ["2026-02-02T00:00:00Z", 3, -60, true, false], ["2026-03-03T00:00:00Z", 1, -15, false, true]] as const)
    for (const b of [direct, directYear, perDay]) b.addCost(Date.parse(at), units, cogs, mcf, unreported);
  const folded = aggregatePnlDays(encodePnlDays(perDay.finish()), pnlPeriodRanges("2026-01-28", "2026-03-03", "month"));
  assert.deepEqual(folded, direct.finish());
  assert.equal(folded.length, 3);
  assert.deepEqual(folded[0].statement.groups[0].types[0].sources, ["AMAZON", "SHOPIFY"]);
  assert.deepEqual(folded[1].statement.mcf, { units: 3, cogs: -60 });
  assert.deepEqual(aggregatePnlDays(encodePnlDays(perDay.finish()), pnlPeriodRanges("2026-01-28", "2026-03-03", "year")), directYear.finish());
}

console.log("P&L period checks passed: date coverage, partial labels, leap years, DST, timezone boundaries, amounts, costs, sources and ratios.");
