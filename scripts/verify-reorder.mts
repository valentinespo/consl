/**
 * Exhaustive check of computeReorder against independent oracles.
 *
 * Sweeps every combination of channel stock, warehouse stock, production, lot timing, floor,
 * lead time, shipping time and buffer (~68,000 scenarios) and asserts, for each row:
 *
 *  1. The OOS day-count matches a literal day-by-day walk of the timeline AND a closed-form
 *     recomputation, both written here from scratch — not the engine's own arithmetic.
 *  2. Each action (ship / expedite / order) matches first-principles need:
 *       ship      — you own stock elsewhere and the channel is inside the buffer, or dark
 *       expedite  — a lot exists and arriving earlier would genuinely shorten the outage
 *       order     — you own less than the floor, or you'd be dark with nothing on the way
 *  3. The pill matches the situation, worst first: OOS → Running low → Healthy/Reordered/Below floor.
 *  4. Hard invariants: a green pill NEVER carries an action; an OOS row ALWAYS carries at least
 *     one; "OOS for 0d" cannot exist; Reordered implies a lot actually exists; order quantity is
 *     a whole multiple of the batch size and never below order-size months of sales.
 *
 * Scenarios where a value sits within a day of a threshold are tallied as boundary cases and
 * exempted from flag equality only (rounding may fall either side); every invariant still holds.
 *
 * Run:  node --import tsx scripts/verify-reorder.mts     (exits 1 on any mismatch)
 */
import { computeReorder, MONTH, MONTH_MS } from "../lib/reorder.js";
import type { RestockRow } from "../lib/restock.js";

const base = {
  id: "x", code: "X", name: "X", imageUrl: null,
  fbaAvailable: 0, fbaInbound: 0, fbaReserved: 0, fbaTotal: 0,
  awdOnhand: 0, awdInbound: 0, awdTotal: 0,
  inProduction: 0, atLocations: 0, atLocationsBy: [{ code: "CRW", units: 0 }],
  onHand: 0, soonestPoISO: null,
  units10d: 0, units30d: 300, units90d: 0,
  salesDays10: 0, salesDays30: 30, salesDays90: 0,
  dailySales: {}, salesEnd: null, windowDays: 30, excludeDays: 0,
  minMonths: 5, leadMonths: 4, shipDays: 30, rawShipDays: null, shipBufferX: 3,
  rawMinMonths: null, rawLeadMonths: null,
  reorderToMonths: 8, rawReorderToMonths: null, batchSize: 0, rawBatchSize: null, sortIndex: null,
} as unknown as RestockRow;

/** Oracle 1: walk the timeline one day at a time and count the days with nothing to sell. */
function walkDark(Ad: number, Ld: number, shipD: number, arriveD: number): { dark: number; lastDark: boolean } {
  let stock = Ad; // days of demand sitting at the channel
  let dark = 0;
  let lastDark = false;
  const horizon = Math.round(arriveD);
  for (let d = 0; d < horizon; d++) {
    if (Ld > 0 && d === Math.round(shipD)) stock += Ld; // the truck loaded today lands
    if (stock > 0) {
      stock = Math.max(0, stock - 1);
      lastDark = false;
    } else {
      dark++;
      lastDark = true;
    }
  }
  return { dark, lastDark };
}

const now = Date.now();
let checked = 0;
let boundary = 0;
const failures: string[] = [];
const matrix = new Map<string, string>();

const GRID = {
  units30d: [0, 150, 300],
  onHand: [0, 40, 150, 400, 900, 1800, 3600],
  atLocations: [0, 60, 400, 1600, 5000],
  production: [0, 400, 3000],
  lotFrac: [-0.15, 0.05, 0.45, 0.95], // when the lot lands, as a fraction of lead+shipping
  minMonths: [2, 5, 9],
  leadMonths: [1.5, 4],
  shipDays: [0, 10, 30, 60],
  shipBufferX: [0, 1, 3],
};

for (const units30d of GRID.units30d)
for (const onHand of GRID.onHand)
for (const atLocations of GRID.atLocations)
for (const inProduction of GRID.production)
for (const lotFrac of inProduction > 0 ? GRID.lotFrac : [0])
for (const minMonths of GRID.minMonths)
for (const leadMonths of GRID.leadMonths)
for (const shipDays of GRID.shipDays)
for (const shipBufferX of GRID.shipBufferX) {
  const shipM = shipDays / MONTH;
  const makeAndMove = leadMonths + shipM;
  const soonestPoISO = inProduction > 0
    ? new Date(now - (makeAndMove - lotFrac * makeAndMove) * MONTH_MS).toISOString()
    : null;
  const row = {
    ...base, units30d, onHand, atLocations, inProduction, soonestPoISO,
    minMonths, leadMonths, shipDays, shipBufferX,
  } as RestockRow;
  const r = computeReorder(row, 30, now);
  checked++;

  const fail = (msg: string) => {
    if (failures.length < 12)
      failures.push(
        `${msg}\n    inputs: sales ${units30d}/mo · channel ${onHand} · CRW ${atLocations} · prod ${inProduction}` +
        ` (lands ${(lotFrac * makeAndMove).toFixed(1)}mo) · floor ${minMonths} · lead ${leadMonths} · ship ${shipDays}d ×${shipBufferX}` +
        `\n    engine: ${r.statusLabel} · ship=${r.ship} expedite=${r.expedite} order=${r.order} qty=${r.recommendedQty} dry=${r.dryDays}`,
      );
    else failures.push(msg.slice(0, 40));
  };

  // ---- Hard invariants: hold in every scenario, no exemptions. -------------------------------
  if ((r.status === "oos") !== (r.dryDays >= 1)) fail("OOS status disagrees with its own day-count");
  if (r.status === "oos" && r.statusLabel !== `OOS for ${r.dryDays}d`) fail("OOS label disagrees with dryDays");
  if (/OOS for 0d/.test(r.statusLabel)) fail('label reads "OOS for 0d"');
  if ((r.status === "ok" || r.status === "reordered") && (r.ship || r.expedite || r.order || r.recommendedQty > 0))
    fail("green pill carries an action");
  if (r.status === "oos" && !r.ship && !r.expedite && !r.order) fail("OOS row with nothing to do");
  if (r.status === "channelLow" && (!r.ship || r.dryDays > 0)) fail("Running low pill without a due shipment");
  if (r.status === "belowFloor" && (!r.order || r.ship || r.expedite)) fail("Below floor pill with wrong actions");
  if (r.status === "reordered" && inProduction === 0) fail("Reordered without a lot in production");
  if ((r.recommendedQty > 0) !== r.order) fail("order flag disagrees with quantity");
  if (!r.ship && r.shipWithinDays !== 0) fail("ship-within shown without a shipment");
  // No sales in the window → the "nosales" situation, never green Healthy, never any action.
  if (units30d === 0 && (r.status !== "nosales" || r.ship || r.expedite || r.order || r.recommendedQty > 0))
    fail("no sales but not the No-sales state");
  if (r.status === "nosales" && (r.ship || r.expedite || r.order)) fail("No-sales row carries an action");
  if (r.order) {
    const minQty = Math.ceil(8 * r.monthly);
    if (r.recommendedQty < minQty) fail("order smaller than order-size months of sales");
    if (row.batchSize! > 0 && r.recommendedQty % row.batchSize! !== 0) fail("order not a batch multiple");
  }

  if (units30d === 0) continue;

  // ---- Oracle recomputation, from raw inputs. ------------------------------------------------
  const monthly = (units30d / 30) * MONTH;
  const A = onHand / monthly;
  const L = atLocations / monthly;
  const total = A + L + inProduction / monthly;
  const hasPO = inProduction > 0;
  const Tc = hasPO ? Math.max(0, lotFrac * makeAndMove) : makeAndMove;
  // The truck only matters if it lands before the lot — the lot ends the outage on its own.
  const gap1 = atLocations > 0 ? Math.max(0, Math.min(shipM, Tc) - A) : 0;
  const endOwn = atLocations > 0 ? Math.max(A, shipM) + L : A;
  const gap2 = Math.max(0, Tc - endOwn);
  const contDays = (gap1 + gap2) * MONTH;
  // The slice of the outage that only the lot's arrival can end.
  const arrivalGap = atLocations > 0 && Tc <= shipM ? gap1 : gap2;

  if (Math.abs(r.dryDays - contDays) > 1.5) fail(`dryDays ${r.dryDays} vs closed-form ${contDays.toFixed(2)}`);
  const walk = walkDark(A * MONTH, L * MONTH, shipM * MONTH, Tc * MONTH);
  if (Math.abs(walk.dark - contDays) > 2) fail(`day-walk ${walk.dark} vs closed-form ${contDays.toFixed(2)}`);

  // Boundary cases: within ~a day of a threshold, rounding may legitimately fall either side.
  const nearEdge =
    (contDays > 0 && contDays < 1.5) ||
    (gap1 * MONTH > 0 && gap1 * MONTH < 1.5) ||
    (gap2 * MONTH > 0 && gap2 * MONTH < 1.5) ||
    (arrivalGap * MONTH > 0 && arrivalGap * MONTH < 1.5) ||
    Math.abs(A - shipM * shipBufferX) * MONTH < 1;
  if (nearEdge) {
    boundary++;
  } else {
    const dark = contDays >= 1;
    const wantShip = atLocations > 0 && (A <= shipM * shipBufferX || dark);
    // The day-walk's own verdict: was the channel dark the day before the lot landed? If yes,
    // and only then, arriving a day earlier would have saved a day.
    const wantExpedite = hasPO && walk.lastDark;
    const wantOrder = total < minMonths || (!hasPO && walk.lastDark);
    if (r.ship !== wantShip) fail(`ship=${r.ship}, first-principles says ${wantShip}`);
    if (r.expedite !== wantExpedite) fail(`expedite=${r.expedite}, day-walk says ${wantExpedite}`);
    if (r.order !== wantOrder) fail(`order=${r.order}, first-principles says ${wantOrder}`);
    const wantPill = dark ? "oos" : wantShip ? "channelLow" : A + L >= minMonths ? "ok" : total >= minMonths ? "reordered" : "belowFloor";
    if (r.status !== wantPill) fail(`pill ${r.status}, situation says ${wantPill}`);
  }

  const acts = [r.ship && "Ship units", r.expedite && "Expedite", r.order && "Order N"].filter(Boolean).join(" · ") || "—";
  const key = `${r.statusLabel.replace(/\d+/, "X").padEnd(14)}| ${acts}`;
  if (!matrix.has(key))
    matrix.set(key, `channel ${A.toFixed(1)}mo · CRW ${L.toFixed(1)}mo · prod ${(inProduction / monthly).toFixed(1)}mo · floor ${minMonths}`);
}

console.log(`Scenarios checked: ${checked.toLocaleString()}  (boundary cases, invariants-only: ${boundary.toLocaleString()})`);
console.log("\nEvery (status | actions) combination that can occur:\n");
console.log("STATUS        | ACTIONS                              EXAMPLE");
console.log("-".repeat(96));
[...matrix.entries()].sort().forEach(([k, v]) => console.log(`${k.padEnd(52)} ${v}`));
console.log(`\nMISMATCHES: ${failures.length}`);
if (failures.length) {
  console.log(failures.slice(0, 12).join("\n\n"));
  process.exit(1);
}
