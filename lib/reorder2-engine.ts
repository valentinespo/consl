import type { RestockRow } from "@/lib/restock";
import { computeReorder, MONTH, type ReorderResult, type ReorderStatus, type Win } from "@/lib/reorder";

/**
 * Reorder 2.0 — the same timeline model as lib/reorder.ts, asked once per PLACE a product sells
 * from instead of once for FBA. Pure and client-safe: the page toggles the sales window without
 * a round trip, exactly like the original dashboard.
 *
 * A place is anywhere stock sits or leaves from: FBA, AWD, one of your own facilities, a Shopify
 * location, a TikTok warehouse. Each place gets its own velocity (units the orders say shipped
 * from there), its own sellable stock (what is there plus what is on its way there), and its own
 * reserve — the surplus at every facility with a ROUTE to it. Then the original engine answers,
 * per place: healthy, running low (a truck must leave), reordered (a run lands in time), below
 * floor, or out of stock — with ship / expedite / order flags.
 *
 * Scenarios covered, in order of the code:
 *  - no sales anywhere: "No sales", nothing to plan.
 *  - a place with stock but no sales (AWD, a warehouse): a donor, shown as "No sales here".
 *  - a place short with a fuller facility on a route: Move — donors are drained most urgent
 *    place first so two places never get the same units suggested twice.
 *  - a place short with no route to help it: the run is the only answer (Order / Expedite).
 *  - production lands at the facility that makes it; it counts for a place only when that facility
 *    has a route to the place. Overdue lots count as landing now, like the original.
 *  - orders with no facility ("unplaced") keep their velocity in the company total so the run
 *    size is right, and show as their own line so the gap is visible.
 *  - the product's status is the worst of its places; a run is sized on the whole company's
 *    velocity and split by each selling place's share.
 */

export type PlaceKind = "own" | "AMAZON_FBA" | "AMAZON_AWD" | "SHOPIFY" | "TIKTOK" | "none";
export type Place = { id: string; code: string; name: string; kind: PlaceKind };
export type StockRoute = { from: string; to: string };

/** One product at one place, as the server hands it over. */
export type PlaceStock = {
  placeId: string;
  sellable: number; // units there now (FBA: available + reserved; a warehouse: its pool; a location: what the platform reports)
  inbound: number; // on its way there (FBA inbound; AWD inbound)
  dailySales: Record<string, number>; // { "YYYY-MM-DD": units } shipped from this place
};

export type Reorder2Row = RestockRow & {
  places: PlaceStock[];
  inProductionBy: { facilityId: string; units: number; soonestPoISO: string | null }[];
};

export type PlaceResult = ReorderResult & {
  place: Place;
  sellable: number;
  inbound: number;
  reserve: number; // surplus reachable over routes
  production: number; // units in production that can reach this place
  selling: boolean;
  moveUnits: number; // suggested units to send here
  moveFrom: { code: string; units: number }[];
};

export type Reorder2Result = {
  status: ReorderStatus;
  statusLabel: string;
  note?: string;
  monthly: number; // whole-company velocity, units per month
  win: Win;
  ship: boolean;
  expedite: boolean;
  order: boolean;
  recommendedQty: number;
  split: { code: string; units: number }[]; // where a run should go, by selling share
  places: PlaceResult[];
  totalUnits: number; // everything owned, everywhere, plus production
  coverMonths: number; // totalUnits / monthly
};

const DAY = 86_400_000;
const SEVERITY: Record<ReorderStatus, number> = { oos: 5, channelLow: 4, belowFloor: 3, reordered: 2, ok: 1, nosales: 0 };

function monthlyOf(daily: Record<string, number>, win: Win, excl: number, endMs: number): number {
  let units = 0;
  for (let i = excl; i < win; i++) units += daily[new Date(endMs - i * DAY).toISOString().slice(0, 10)] ?? 0;
  const days = win - excl;
  return days > 0 ? (units / days) * MONTH : 0;
}

export function computeReorder2(row: Reorder2Row, places: Place[], routes: StockRoute[], globalWin: Win, nowMs: number): Reorder2Result {
  const win: Win = row.windowDays === 10 || row.windowDays === 30 || row.windowDays === 90 ? row.windowDays : globalWin;
  const excl = Math.min(Math.max(0, row.excludeDays ?? 0), win - 1);
  const endMs = nowMs - 2 * DAY; // orders are complete up to a couple of days ago on every channel
  const anchorISO = new Date(endMs).toISOString();
  const placeById = new Map(places.map((p) => [p.id, p]));
  const feeds = new Map<string, Set<string>>(); // to → froms
  for (const r of routes) feeds.set(r.to, new Set([...(feeds.get(r.to) ?? []), r.from]));

  // Pass 1 — each place's own velocity and stock.
  const cells = row.places
    .filter((c) => placeById.has(c.placeId))
    .map((c) => ({ ...c, place: placeById.get(c.placeId)!, monthly: monthlyOf(c.dailySales, win, excl, endMs) }));
  const monthly = cells.reduce((t, c) => t + c.monthly, 0);

  // Pass 2 — what each facility could give away: everything, or what is beyond its own floor
  // when it sells too. Unplaced demand and inbound units are never a donor.
  const surplus = new Map<string, number>();
  for (const c of cells) {
    if (c.place.kind === "none") continue;
    const keep = c.monthly > 0 ? Math.ceil(row.minMonths * c.monthly) : 0;
    surplus.set(c.placeId, Math.max(0, c.sellable - keep));
  }

  // Pass 3 — the original engine, per place, with its reserve = reachable surplus and its
  // production = lots at facilities that can reach it.
  const results: PlaceResult[] = cells.map((c) => {
    // Orders with no facility: their velocity counts toward the company's run size, but there is
    // no stock to judge — never a status, never an outage.
    if (c.place.kind === "none") {
      const neutral: ReorderResult = { monthly: c.monthly, win, excl, override: false, onHandCover: 0, awdCover: 0, locCover: 0, prodCover: 0, status: "nosales", statusLabel: "Not placed", recommendedQty: 0, ship: false, expedite: false, order: false, shipWithinDays: 0, dryDays: 0, belowFloor: false };
      return { ...neutral, place: c.place, sellable: 0, inbound: 0, reserve: 0, production: 0, selling: c.monthly > 0, moveUnits: 0, moveFrom: [] };
    }
    const froms = feeds.get(c.placeId) ?? new Set<string>();
    let reserve = 0;
    for (const f of froms) if (f !== c.placeId) reserve += surplus.get(f) ?? 0;
    let production = 0;
    let soonest: string | null = null;
    for (const ip of row.inProductionBy) {
      if (ip.facilityId !== c.placeId && !froms.has(ip.facilityId)) continue;
      production += ip.units;
      if (ip.soonestPoISO && (!soonest || ip.soonestPoISO < soonest)) soonest = ip.soonestPoISO;
    }
    const synthetic: RestockRow = {
      ...row,
      dailySales: c.dailySales,
      salesEnd: anchorISO,
      // Never the product-wide report totals: a place with no orders of its own sells nothing.
      units10d: 0,
      units30d: 0,
      units90d: 0,
      fbaTotal: c.sellable + c.inbound,
      awdTotal: 0,
      atLocations: c.place.kind === "none" ? 0 : reserve,
      atLocationsBy: [],
      inProduction: c.place.kind === "none" ? 0 : production,
      soonestPoISO: soonest,
    };
    const res = computeReorder(synthetic, globalWin, nowMs);
    const selling = c.monthly > 0;
    if (!selling && c.place.kind !== "none") {
      res.status = "nosales";
      res.statusLabel = "No sales here";
      res.note = c.sellable + c.inbound > 0 ? "holds stock other places can draw on" : undefined;
    }
    return { ...res, place: c.place, sellable: c.sellable, inbound: c.inbound, reserve, production, selling, moveUnits: 0, moveFrom: [] };
  })
    // A place with nothing there, nothing coming and no sales in the window says nothing.
    .filter((r) => r.selling || r.sellable + r.inbound > 0 || r.production > 0);

  // Pass 4 — moves. The most urgent place drains donors first; a donor gives what its surplus
  // allows and not a unit more, so two places never get the same stock suggested.
  const remaining = new Map(surplus);
  const donorRank = (id: string) => {
    const p = placeById.get(id);
    const sells = cells.find((c) => c.placeId === id)?.monthly ?? 0;
    return (sells > 0 ? 10 : 0) + (p?.kind === "AMAZON_AWD" ? 1 : p?.kind === "own" ? 0 : 2);
  };
  const urgent = results.filter((r) => r.ship && r.place.kind !== "none").sort((a, b) => b.dryDays - a.dryDays || a.onHandCover - b.onHandCover);
  for (const r of urgent) {
    const c = cells.find((x) => x.placeId === r.place.id)!;
    // Bring the place to its floor; if it is above the floor but inside the shipping buffer, a
    // shipping cycle's worth.
    const toFloor = Math.max(0, Math.ceil(row.minMonths * c.monthly) - (c.sellable + c.inbound));
    let need = toFloor > 0 ? toFloor : Math.ceil((row.shipDays / MONTH) * c.monthly);
    const donors = [...(feeds.get(r.place.id) ?? [])].filter((f) => f !== r.place.id && (remaining.get(f) ?? 0) > 0).sort((a, b) => donorRank(a) - donorRank(b));
    for (const d of donors) {
      if (need <= 0) break;
      const give = Math.min(remaining.get(d) ?? 0, need);
      if (give <= 0) continue;
      remaining.set(d, (remaining.get(d) ?? 0) - give);
      need -= give;
      r.moveUnits += give;
      r.moveFrom.push({ code: placeById.get(d)?.code ?? "?", units: give });
    }
  }

  // Pass 5 — the company. Worst place names the product; a run is sized on every place's
  // velocity together and split by share.
  const selling = results.filter((r) => r.selling && r.place.kind !== "none");
  const worst = selling.reduce<PlaceResult | null>((w, r) => (!w || SEVERITY[r.status] > SEVERITY[w.status] ? r : w), null);
  const totalUnits = cells.reduce((t, c) => t + c.sellable + c.inbound, 0) + row.inProductionBy.reduce((t, p) => t + p.units, 0);
  const coverMonths = monthly > 0 ? totalUnits / monthly : totalUnits > 0 ? Infinity : 0;
  const order = monthly > 0 && (selling.some((r) => r.order) || coverMonths < row.minMonths);
  let recommendedQty = 0;
  if (order) {
    const raw = Math.ceil(row.reorderToMonths * monthly);
    recommendedQty = row.batchSize > 0 && raw > 0 ? Math.ceil(raw / row.batchSize) * row.batchSize : raw;
  }
  // Where the run should go: each selling place's share of the company's velocity, rounded so
  // the pieces add up to the run.
  let split: { code: string; units: number }[] = [];
  if (recommendedQty > 0 && selling.length) {
    const share = selling.map((r) => ({ code: r.place.code, monthly: cells.find((c) => c.placeId === r.place.id)?.monthly ?? 0 }));
    const sum = share.reduce((t, x) => t + x.monthly, 0) || 1;
    split = share.map((x) => ({ code: x.code, units: Math.floor((recommendedQty * x.monthly) / sum) })).sort((a, b) => b.units - a.units);
    const rest = recommendedQty - split.reduce((t, x) => t + x.units, 0);
    if (split.length) split[0].units += rest;
    split = split.filter((x) => x.units > 0);
  }
  const status: ReorderStatus = monthly > 0 ? (worst?.status ?? "ok") : "nosales";
  const statusLabel = monthly > 0 ? (worst?.statusLabel ?? "Healthy") : "No sales";
  const note = worst?.note;
  return {
    status,
    statusLabel,
    note,
    monthly,
    win,
    ship: results.some((r) => r.ship),
    expedite: results.some((r) => r.expedite),
    order,
    recommendedQty,
    split,
    places: results,
    totalUnits,
    coverMonths,
  };
}
