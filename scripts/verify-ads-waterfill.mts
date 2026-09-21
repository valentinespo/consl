/** Run with: node --import tsx scripts/verify-ads-waterfill.mts */
import assert from "node:assert/strict";
import { HELD_SUFFIX, UNTYPED_AD_SPEND, addDayRange, adProgramLabel, coveredFromFor, coveredRangesFor, dayRangesOf, daysBetween, unifyAdInvoices, waterfillAdInvoices, type AdSpendByDay, type FeedAdInvoice, type LedgerAdCharge } from "../lib/ads-waterfill.js";

const SP = "Sponsored Products";
const SB = "Sponsored Brands";
const flat = (perDay: Record<string, number>, type = SP): AdSpendByDay => new Map(Object.entries(perDay).map(([d, v]) => [d, new Map([[type, v]])]));
const dayTotals = (rows: { day: string; amount: number; held: boolean }[], held = false) => {
  const m = new Map<string, number>();
  for (const r of rows) if (r.held === held) m.set(r.day, Math.round(((m.get(r.day) ?? 0) + r.amount) * 100) / 100);
  return Object.fromEntries([...m].sort());
};
const total = (rows: { amount: number; held: boolean }[], held = false) => Math.round(rows.filter((r) => r.held === held).reduce((t, r) => t + r.amount, 0) * 100) / 100;

// 1. The transition (agreed 2026-09-15): A Jul14–16 $500 with the API knowing only the 16th = $10
//    → 16th = 10, the 14th and 15th (unknown) = 245 each. No surplus at the transition.
{
  const r = waterfillAdInvoices({
    invoices: [{ id: "pre", day: "2026-07-14", amount: 400 }, { id: "A", day: "2026-07-16", amount: 500 }],
    spend: flat({ "2026-07-16": 10 }),
    coveredFrom: "2026-07-16",
    coveredTo: "2026-07-16",
  });
  const a = r.perInvoice.find((p) => p.id === "A")!;
  assert.deepEqual([...a.placed].sort(), [["2026-07-14", 24500], ["2026-07-15", 24500], ["2026-07-16", 1000]]);
  assert.equal(a.surplus, 0);
}

// 2. The chain (agreed 2026-09-15): API $170/day from the 16th, a $500 invoice at every
//    threshold with shared boundary days. Every day = the API figure, every invoice = its amount.
{
  const spend: Record<string, number> = {};
  for (const d of daysBetween("2026-07-16", "2026-07-25")) spend[d] = 170;
  const r = waterfillAdInvoices({
    invoices: [
      { id: "pre", day: "2026-07-14", amount: 500 },
      { id: "A", day: "2026-07-16", amount: 500 },
      { id: "B", day: "2026-07-19", amount: 500 },
      { id: "C", day: "2026-07-22", amount: 500 },
      { id: "D", day: "2026-07-25", amount: 500 },
    ],
    spend: flat(spend),
    coveredFrom: "2026-07-16",
    coveredTo: "2026-07-25",
  });
  const of = (id: string) => Object.fromEntries([...r.perInvoice.find((p) => p.id === id)!.placed].map(([d, c]) => [d.slice(8), c / 100]).sort());
  assert.deepEqual(of("A"), { "14": 165, "15": 165, "16": 170 });
  assert.deepEqual(of("B"), { "17": 170, "18": 170, "19": 160 });
  assert.deepEqual(of("C"), { "19": 10, "20": 170, "21": 170, "22": 150 });
  assert.deepEqual(of("D"), { "22": 20, "23": 170, "24": 170, "25": 140 });
  // The 25th shows 30 held until the next invoice; every covered day totals the API's 170.
  assert.deepEqual(dayTotals(r.rows, true), { "2026-07-25": 30 });
  const billed = dayTotals(r.rows);
  for (const d of daysBetween("2026-07-16", "2026-07-24")) assert.equal(billed[d], 170, d);
  assert.equal(billed["2026-07-25"], 140);
  assert.equal(total(r.rows), 2500); // the five invoices, to the cent
}

// 3. A surplus (corrections): every day covered, the invoice exceeds its days' spend → the days
//    fill, the surplus lands on the invoice's last day, and the next invoice finds no room there.
{
  const r = waterfillAdInvoices({
    invoices: [
      { id: "pre", day: "2026-07-16", amount: 0.01 },
      { id: "B", day: "2026-07-18", amount: 700 },
      { id: "C", day: "2026-07-20", amount: 300 },
    ],
    spend: flat({ "2026-07-16": 133.34, "2026-07-17": 250, "2026-07-18": 260, "2026-07-19": 200, "2026-07-20": 200 }),
    coveredFrom: "2026-07-16",
    coveredTo: "2026-07-20",
  });
  const b = r.perInvoice.find((p) => p.id === "B")!;
  assert.equal(b.surplus, 5667);
  assert.deepEqual([...b.placed].sort(), [["2026-07-16", 13333], ["2026-07-17", 25000], ["2026-07-18", 31667]]);
  const c = r.perInvoice.find((p) => p.id === "C")!;
  assert.deepEqual([...c.placed].sort(), [["2026-07-19", 20000], ["2026-07-20", 10000]]);
  assert.deepEqual(dayTotals(r.rows, true), { "2026-07-20": 100 });
}

// 4. A shortfall (validation removed clicks): the invoice is smaller than its days' spend, the
//    room is left at the END of its period and the next invoice fills it first. Room left on a
//    day before the last cut is never counted (the invoice is the amount of record).
{
  const r = waterfillAdInvoices({
    invoices: [
      { id: "pre", day: "2026-08-01", amount: 1 },
      { id: "A", day: "2026-08-03", amount: 250 },
      { id: "B", day: "2026-08-05", amount: 320 },
    ],
    spend: flat({ "2026-08-01": 1, "2026-08-02": 200, "2026-08-03": 200, "2026-08-04": 200, "2026-08-05": 200 }),
    coveredFrom: "2026-08-01",
    coveredTo: "2026-08-05",
  });
  assert.deepEqual([...r.perInvoice[1].placed].sort(), [["2026-08-02", 20000], ["2026-08-03", 5000]]);
  assert.deepEqual([...r.perInvoice[2].placed].sort(), [["2026-08-03", 15000], ["2026-08-04", 17000]]);
  assert.deepEqual(dayTotals(r.rows, true), { "2026-08-05": 200 }); // the 4th's 30 of room is NOT held
  assert.equal(total(r.rows), 571);
}

// 5. No API data at all: every invoice spreads evenly over its own period, untyped.
{
  const r = waterfillAdInvoices({
    invoices: [{ id: "a", day: "2026-01-10", amount: 100 }, { id: "b", day: "2026-01-13", amount: 100.01 }],
    spend: new Map(),
    coveredFrom: null,
    coveredTo: null,
  });
  // (the odd cent of an even split goes to the period's first day)
  assert.deepEqual(dayTotals(r.rows), { "2026-01-10": 125.01, "2026-01-11": 25, "2026-01-12": 25, "2026-01-13": 25 });
  assert.ok(r.rows.every((x) => x.type === UNTYPED_AD_SPEND && !x.shaped && !x.held));
}

// 6. Two invoices on the same day (spend above the threshold twice in a day) and the ad-type
//    split: a day's amount follows the API's split between ad types, to the cent.
{
  const spend: AdSpendByDay = new Map([
    ["2026-08-04", new Map([[SP, 300], [SB, 100]])],
    ["2026-08-05", new Map([[SP, 600.03], [SB, 400.02]])],
  ]);
  const r = waterfillAdInvoices({
    invoices: [
      { id: "pre", day: "2026-08-04", amount: 100 },
      { id: "one", day: "2026-08-05", amount: 501.5 },
      { id: "two", day: "2026-08-05", amount: 509.65 },
    ],
    spend,
    coveredFrom: "2026-08-04",
    coveredTo: "2026-08-05",
  });
  assert.deepEqual([...r.perInvoice[1].placed].sort(), [["2026-08-04", 30000], ["2026-08-05", 20150]]);
  assert.deepEqual([...r.perInvoice[2].placed].sort(), [["2026-08-05", 50965]]);
  const day5 = r.rows.filter((x) => x.day === "2026-08-05" && !x.held);
  assert.equal(Math.round(day5.reduce((t, x) => t + x.amount, 0) * 100), 71115);
  const sp5 = day5.find((x) => x.type === SP)!.amount;
  assert.ok(Math.abs(sp5 / 711.15 - 0.6) < 0.0001, `SP share ${sp5}`);
  const held = r.rows.filter((x) => x.held);
  assert.ok(held.every((x) => x.type.endsWith(HELD_SUFFIX)));
  assert.equal(Math.round(held.reduce((t, x) => t + x.amount, 0) * 100), 100005 - 71115);
}

// 7. Invariants on random histories: every invoice is placed whole and inside its period, a
//    covered day never exceeds the API's figure except by a surplus, held is never negative.
{
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let run = 0; run < 300; run++) {
    const all = daysBetween("2026-03-01", "2026-05-15");
    const coveredFrom = all[Math.floor(rnd() * 40)];
    const coveredTo = all[all.length - 1 - Math.floor(rnd() * 3)];
    const spend: AdSpendByDay = new Map();
    for (const d of all) if (d >= coveredFrom && d <= coveredTo && rnd() > 0.05) spend.set(d, new Map([[SP, Math.round(rnd() * 60000) / 100], [SB, rnd() > 0.5 ? Math.round(rnd() * 20000) / 100 : 0]]));
    const invoices = [];
    let i = 0;
    while (i < all.length) {
      invoices.push({ id: `i${i}`, day: all[i], amount: Math.round((300 + rnd() * 400) * 100) / 100 });
      i += Math.floor(rnd() * 4); // 0 = a second invoice the same day
      if (rnd() > 0.7) i += 1;
    }
    const r = waterfillAdInvoices({ invoices, spend, coveredFrom, coveredTo });
    const perDay = new Map<string, number>();
    r.perInvoice.forEach((p, k) => {
      const sum = [...p.placed.values()].reduce((t, c) => t + c, 0);
      assert.equal(sum, Math.round(invoices[k].amount * 100), `invoice ${p.id} placed whole`);
      for (const [d, c] of p.placed) {
        assert.ok(d >= p.from && d <= p.to, `inside its period`);
        perDay.set(d, (perDay.get(d) ?? 0) + c);
      }
    });
    const surplusOn = new Map<string, number>();
    for (const p of r.perInvoice) if (p.surplus) surplusOn.set(p.to, (surplusOn.get(p.to) ?? 0) + p.surplus);
    for (const [d, c] of perDay) {
      if (d < coveredFrom || d > coveredTo) continue;
      const api = [...(spend.get(d)?.values() ?? [])].reduce((t, v) => t + Math.round(v * 100), 0);
      assert.ok(c - (surplusOn.get(d) ?? 0) <= api, `day ${d}: ${c} placed vs ${api} spent`);
    }
    const billed = Math.round(r.rows.filter((x) => !x.held).reduce((t, x) => t + x.amount, 0) * 100);
    assert.equal(billed, invoices.reduce((t, x) => t + Math.round(x.amount * 100), 0), "the statement books the invoices, to the cent");
    assert.ok(r.rows.every((x) => x.amount > 0));
  }
}

// 8. Complete from: only the ad types the account spends on decide it. Sponsored Products alone
//    reaches back the furthest, so an SP-only company gets every day Amazon still has.
{
  const coverage = { SPONSORED_PRODUCTS: "2026-06-20", SPONSORED_BRANDS: "2026-07-25", SPONSORED_DISPLAY: "2026-07-20" };
  assert.equal(coveredFromFor(coverage, ["SPONSORED_PRODUCTS"], null), "2026-06-20");
  assert.equal(coveredFromFor(coverage, ["SPONSORED_PRODUCTS", "SPONSORED_DISPLAY"], null), "2026-07-20");
  assert.equal(coveredFromFor(coverage, ["SPONSORED_PRODUCTS", "SPONSORED_BRANDS", "SPONSORED_DISPLAY"], null), "2026-07-25");
  assert.equal(coveredFromFor(coverage, [], "2026-06-20"), "2026-06-20"); // no spend at all: the import's own first day
  assert.equal(coveredFromFor(null, ["SPONSORED_PRODUCTS"], "2026-06-22"), "2026-06-22");
  assert.equal(coveredFromFor({ SPONSORED_PRODUCTS: "garbage" }, ["SPONSORED_PRODUCTS"], null), null);
}

// 9. Exact periods from the invoice feed, the invoice's own ad-type split on days the API doesn't
//    cover, and what it bills outside the API's ad types (Creator Connections) under its own name.
{
  const r = waterfillAdInvoices({
    invoices: [
      { id: "old", day: "2026-05-03", from: "2026-05-02", amount: 100, mix: { "Sponsored Products": 80, "Sponsored Brands": 20 } },
      { id: "cc", day: "2026-08-02", from: "2026-08-01", amount: 120, mix: { "Sponsored Products": 100, "Creator Connections": 20 } },
    ],
    spend: flat({ "2026-08-01": 70, "2026-08-02": 70 }),
    coveredFrom: "2026-08-01",
    coveredTo: "2026-08-02",
  });
  const get = (day: string, type: string) => r.rows.find((x) => x.day === day && x.type === type && !x.held)?.amount ?? 0;
  assert.equal(get("2026-05-02", "Sponsored Products"), 40);
  assert.equal(get("2026-05-02", "Sponsored Brands"), 10);
  assert.equal(get("2026-05-03", "Sponsored Products"), 40);
  assert.equal(get("2026-08-01", "Creator Connections"), 10);
  assert.equal(get("2026-08-02", "Creator Connections"), 10);
  assert.equal(get("2026-08-01", SP), 70);
  assert.equal(get("2026-08-02", SP), 30);
  assert.equal(r.perInvoice[1].surplus, 0);
  assert.deepEqual(dayTotals(r.rows, true), { "2026-08-02": 40 });
  assert.equal(total(r.rows), 220);
  assert.equal(adProgramLabel("SPONSORED PRODUCT"), "Sponsored Products");
  assert.equal(adProgramLabel("SPONSORED DISPLAY FOR FIRE TV"), "Sponsored Display");
  assert.equal(adProgramLabel("CREATOR CONNECTIONS"), "Creator Connections");
}

// 10. Every billing history books each invoice exactly once.
{
  const F = (id: string, from: string, to: string, amount: number, method: "balance" | "card" | "unknown", status = "PAID_IN_FULL"): FeedAdInvoice =>
    ({ id, from, to, invoiceDay: to, amount, status, detail: method !== "unknown", balancePaid: method === "balance" ? amount : 0 });
  const L = (id: string, day: string, amount: number): LedgerAdCharge => ({ id, day, amount });
  const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((t, x) => t + x.amount, 0) * 100) / 100;

  // a. always from the balance: the money report is the amount, the feed lends the period
  let u = unifyAdInvoices({ ledger: [L("l1", "2026-09-13", 500.43), L("l2", "2026-09-15", 504.73)], feed: [F("f1", "2026-09-12", "2026-09-13", 500.43, "balance"), F("f2", "2026-09-13", "2026-09-14", 504.73, "balance")], floorDay: "2025-01-31" });
  assert.deepEqual(u.invoices.map((x) => [x.id, x.from, x.day, x.amount]), [["l1", "2026-09-12", "2026-09-13", 500.43], ["l2", "2026-09-13", "2026-09-14", 504.73]]);
  assert.deepEqual([u.matched, u.fromFeed, u.fromLedgerOnly], [2, 0, 0]);

  // b. always by card: nothing in the money report, every invoice comes from the feed
  u = unifyAdInvoices({ ledger: [], feed: [F("c1", "2026-08-01", "2026-08-31", 1830.12, "card"), F("c2", "2026-09-01", "2026-09-30", 1710, "card", "ISSUED")], floorDay: "2026-01-01" });
  assert.equal(sum(u.invoices), 3540.12);
  assert.equal(u.fromFeed, 2);

  // c. balance, then card, then balance again, then card — with a card invoice of the very same
  //    amount as a balance one issued days apart
  const feed = [
    F("b1", "2026-06-01", "2026-06-03", 500.1, "balance"), F("b2", "2026-06-03", "2026-06-05", 500.2, "balance"),
    F("k1", "2026-06-05", "2026-06-08", 500.2, "card"), F("k2", "2026-06-08", "2026-06-10", 501, "card"),
    F("b3", "2026-06-10", "2026-06-12", 501, "balance"), F("k3", "2026-06-12", "2026-06-15", 499.99, "card"),
  ];
  const ledger = [L("x1", "2026-06-03", 500.1), L("x2", "2026-06-06", 500.2), L("x3", "2026-06-13", 501)];
  u = unifyAdInvoices({ ledger, feed, floorDay: "2026-01-01" });
  assert.equal(sum(u.invoices), sum(feed), "six invoices, six amounts, once each");
  assert.deepEqual(u.invoices.map((x) => x.id), ["x1", "x2", "k1", "k2", "x3", "k3"]);
  assert.deepEqual(u.invoices.map((x) => x.day), ["2026-06-03", "2026-06-05", "2026-06-08", "2026-06-10", "2026-06-12", "2026-06-15"]);

  // d. details not read yet: balance charges still get their periods, card invoices wait (never
  //    double counted meanwhile), and count once their detail says how they were paid
  const unread = feed.map((f) => ({ ...f, detail: false, balancePaid: 0 }));
  u = unifyAdInvoices({ ledger, feed: unread, floorDay: "2026-01-01" });
  assert.equal(sum(u.invoices), sum(ledger));
  assert.equal(u.waitingDetail, 3);

  // e. a balance invoice whose deduction hasn't posted yet is not booked from the feed (its spend
  //    shows as not invoiced yet until the money report has it) — and is when it posts
  u = unifyAdInvoices({ ledger: [], feed: [F("late", "2026-09-19", "2026-09-20", 508.88, "balance")], floorDay: "2026-01-01" });
  assert.equal(u.invoices.length, 0);
  u = unifyAdInvoices({ ledger: [L("p", "2026-09-21", 508.88)], feed: [F("late", "2026-09-19", "2026-09-20", 508.88, "balance")], floorDay: "2026-01-01" });
  assert.deepEqual(u.invoices.map((x) => [x.id, x.from, x.day]), [["p", "2026-09-19", "2026-09-20"]]);

  // f. written off after being charged to the balance: the charge is in the money report (and its
  //    credit stays where Amazon posted it); a written-off card invoice is not booked
  u = unifyAdInvoices({ ledger: [L("w", "2025-11-02", 490.34)], feed: [{ ...F("wo", "2025-10-27", "2025-11-01", 490.34, "balance", "WRITTEN_OFF") }, F("wc", "2025-11-01", "2025-11-05", 120, "card", "WRITTEN_OFF")], floorDay: "2025-01-31" });
  assert.deepEqual(u.invoices.map((x) => [x.id, x.from, x.day, x.amount]), [["w", "2025-10-27", "2025-11-01", 490.34]]);

  // f2. …and once Amazon has refunded it and re-issued it corrected, months later (seen in real data):
  //     the charge and its refund leave together, the re-issue lands on the period of the spend
  u = unifyAdInvoices({
    ledger: [L("w", "2025-11-02", 490.34), L("re", "2026-02-24", 489.34)],
    credits: [L("refund", "2026-02-24", 490.34), L("other-credit", "2026-03-01", 12)],
    feed: [F("wo", "2025-10-27", "2025-11-01", 490.34, "balance", "WRITTEN_OFF"), { ...F("reissue", "2025-10-27", "2025-11-01", 489.34, "balance"), invoiceDay: "2026-02-24" }],
    floorDay: "2025-01-31",
  });
  assert.deepEqual(u.invoices.map((x) => [x.id, x.from, x.day, x.amount]), [["re", "2025-10-27", "2025-11-01", 489.34]]);
  assert.deepEqual(u.cancelledCreditIds, ["refund"]);
  //     …but not before the refund has posted: until then the charge stays, cash-true
  u = unifyAdInvoices({ ledger: [L("w", "2025-11-02", 490.34)], credits: [], feed: [F("wo", "2025-10-27", "2025-11-01", 490.34, "balance", "WRITTEN_OFF")], floorDay: "2025-01-31" });
  assert.equal(u.invoices.length, 1);
  assert.deepEqual(u.cancelledCreditIds, []);

  // f3. the rule is nobody's special case: two write-offs of the SAME amount, one refunded and one
  //     not yet, plus an unrelated credit of that same amount posted BEFORE either charge — only
  //     the refunded write-off leaves, with a refund posted after it; everything else stays put
  u = unifyAdInvoices({
    ledger: [L("c1", "2026-03-04", 250), L("c2", "2026-05-09", 250)],
    credits: [L("early", "2026-01-15", 250), L("refund1", "2026-04-20", 250)],
    feed: [F("w1", "2026-03-01", "2026-03-04", 250, "balance", "WRITTEN_OFF"), F("w2", "2026-05-06", "2026-05-09", 250, "balance", "WRITTEN_OFF")],
    floorDay: "2025-01-01",
  });
  assert.deepEqual(u.cancelledCreditIds, ["refund1"]);
  assert.deepEqual(u.invoices.map((x) => x.id), ["c2"]); // c1 left with its refund; c2 waits for its own
  //     a partial credit is not a write-off refund: it stays where Amazon posted it
  u = unifyAdInvoices({ ledger: [L("c", "2026-03-04", 250)], credits: [L("part", "2026-03-20", 40)], feed: [F("w", "2026-03-01", "2026-03-04", 250, "balance", "WRITTEN_OFF")], floorDay: "2025-01-01" });
  assert.deepEqual([u.invoices.length, u.cancelledCreditIds.length], [1, 0]);

  // g. paid part from the balance, part by card: each part once
  u = unifyAdInvoices({ ledger: [L("half", "2026-07-02", 200)], feed: [{ ...F("mix", "2026-06-28", "2026-07-01", 500, "card"), balancePaid: 200 }], floorDay: "2026-01-01" });
  assert.equal(sum(u.invoices), 500);

  // h. older than the feed or the money report reach: a charge with no feed invoice keeps its
  //    guessed period; a feed invoice from before the company's Amazon history is left out
  u = unifyAdInvoices({ ledger: [L("old", "2025-02-01", 300)], feed: [F("ancient", "2024-03-25", "2024-03-26", 2.37, "card")], floorDay: "2025-01-31" });
  assert.deepEqual(u.invoices.map((x) => [x.id, x.from ?? null]), [["old", null]]);
}

// 11. A connection down for longer than Amazon keeps daily data leaves a HOLE. Its days are not
//     "days without spend": they are not covered, so their invoices spread over their own periods,
//     nothing piles up as a surplus, nothing in the hole shows as "not invoiced yet", and both
//     sides of the hole keep following the API's daily figures.
{
  let sp: [string, string][] = [];
  sp = addDayRange(sp, "2026-01-01", "2026-01-31");
  sp = addDayRange(sp, "2026-02-01", "2026-02-10"); // touches the first: one range
  sp = addDayRange(sp, "2026-07-01", "2026-07-20"); // five months later
  sp = addDayRange(sp, "2026-07-18", "2026-07-25"); // the 3-day re-read overlaps: merged
  assert.deepEqual(sp, [["2026-01-01", "2026-02-10"], ["2026-07-01", "2026-07-25"]]);
  assert.deepEqual(dayRangesOf("2026-06-20", "2026-09-21"), [["2026-06-20", "2026-09-21"]]); // the shape stored before ranges
  const coverage = { SPONSORED_PRODUCTS: sp, SPONSORED_BRANDS: [["2026-01-10", "2026-02-10"], ["2026-07-05", "2026-07-25"]], SPONSORED_DISPLAY: [["2026-07-01", "2026-07-25"]] };
  assert.deepEqual(coveredRangesFor(coverage, ["SPONSORED_PRODUCTS"], null, []), sp);
  assert.deepEqual(coveredRangesFor(coverage, ["SPONSORED_PRODUCTS", "SPONSORED_BRANDS"], null, []), [["2026-01-10", "2026-02-10"], ["2026-07-05", "2026-07-25"]]);
  assert.deepEqual(coveredRangesFor({}, ["SPONSORED_PRODUCTS"], null, [["2026-03-01", "2026-03-02"]]), [["2026-03-01", "2026-03-02"]]);

  const spend: Record<string, number> = {};
  for (const d of [...daysBetween("2026-02-06", "2026-02-10"), ...daysBetween("2026-07-01", "2026-07-06")]) spend[d] = 100;
  const r = waterfillAdInvoices({
    invoices: [
      { id: "before", from: "2026-02-07", day: "2026-02-09", amount: 290 },
      { id: "straddle", from: "2026-02-09", day: "2026-02-12", amount: 400 }, // 9th has 10 left, 10th 100, then the hole
      { id: "hole", from: "2026-04-01", day: "2026-04-04", amount: 400 },
      { id: "after", from: "2026-07-01", day: "2026-07-03", amount: 250 },
    ],
    spend: flat(spend),
    covered: [["2026-02-06", "2026-02-10"], ["2026-07-01", "2026-07-06"]],
  });
  const of = (id: string) => Object.fromEntries([...r.perInvoice.find((p) => p.id === id)!.placed].map(([d, c]) => [d.slice(5), c / 100]).sort());
  assert.deepEqual(of("before"), { "02-07": 100, "02-08": 100, "02-09": 90 });
  assert.deepEqual(of("straddle"), { "02-09": 10, "02-10": 100, "02-11": 145, "02-12": 145 });
  assert.deepEqual(of("hole"), { "04-01": 100, "04-02": 100, "04-03": 100, "04-04": 100 });
  assert.deepEqual(of("after"), { "07-01": 100, "07-02": 100, "07-03": 50 });
  assert.ok(r.perInvoice.every((p) => p.surplus === 0));
  // held: only on and after the last cut (Jul 3) — never the 6th of February, long since billed
  assert.deepEqual(dayTotals(r.rows, true), { "2026-07-03": 50, "2026-07-04": 100, "2026-07-05": 100, "2026-07-06": 100 });
  assert.equal(total(r.rows), 1340);
}

console.log("ads water-fill: all checks passed");
