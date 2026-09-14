import "server-only";
import { prisma } from "@/lib/prisma";
import { getOrgSettings } from "@/lib/settings";

/**
 * Stock routes — which facilities can send finished stock to which. Reorder 2.0 only ever
 * suggests a move along a route; without one, stock somewhere else is simply not available to a
 * place that runs low. Stored on Settings as [{ from, to }] once the operator edits the grid; until
 * then the suggested set applies: every own facility to every other place, AWD to FBA, plus every
 * lane the movement history proves was used.
 */

export type StockRoute = { from: string; to: string };
export type RouteFacility = { id: string; code: string; name: string; type: string; channel: string | null };

const PLACE_ORDER = (f: RouteFacility) =>
  f.channel === "AMAZON_FBA" ? 1 : f.channel === "AMAZON_AWD" ? 2 : f.channel === "SHOPIFY" ? 3 : f.channel === "TIKTOK" ? 4 : 0;

/** Active facilities that can hold or receive finished stock, own places first. */
export async function routeFacilities(): Promise<RouteFacility[]> {
  const rows = await prisma.facility.findMany({
    where: { inactive: false },
    select: { id: true, code: true, name: true, type: true, channel: true },
    orderBy: { code: "asc" },
  });
  return rows.sort((a, b) => PLACE_ORDER(a) - PLACE_ORDER(b) || a.code.localeCompare(b.code));
}

/** The routes consl would assume for a company that never edited the grid. */
export async function suggestedStockRoutes(facilities: RouteFacility[]): Promise<StockRoute[]> {
  const out = new Map<string, StockRoute>();
  const add = (from: string, to: string) => {
    if (from !== to) out.set(`${from}>${to}`, { from, to });
  };
  const own = facilities.filter((f) => !f.channel);
  const fba = facilities.filter((f) => f.channel === "AMAZON_FBA");
  const awd = facilities.filter((f) => f.channel === "AMAZON_AWD");
  for (const f of own) for (const t of facilities) add(f.id, t.id);
  for (const a of awd) for (const b of fba) add(a.id, b.id);
  // Lanes the company has actually used: transfers between its facilities, and shipments to a
  // channel's places.
  const byChannelRoot = new Map<string, string[]>();
  for (const f of facilities) {
    if (!f.channel) continue;
    const root = f.channel.startsWith("AMAZON") ? "AMAZON" : f.channel;
    byChannelRoot.set(root, [...(byChannelRoot.get(root) ?? []), f.id]);
  }
  const moves = await prisma.stockMovement.findMany({
    where: { itemType: "FINISHED", fromFacilityId: { not: null } },
    select: { fromFacilityId: true, toFacilityId: true, toDestination: true },
    distinct: ["fromFacilityId", "toFacilityId", "toDestination"],
  });
  for (const m of moves) {
    if (!m.fromFacilityId) continue;
    if (m.toFacilityId) add(m.fromFacilityId, m.toFacilityId);
    else if (m.toDestination) for (const id of byChannelRoot.get(m.toDestination) ?? []) add(m.fromFacilityId, id);
  }
  return [...out.values()];
}

/** The routes in force: the saved grid, or the suggested set when nothing was saved yet. */
export async function getStockRoutes(): Promise<{ facilities: RouteFacility[]; routes: StockRoute[]; saved: boolean }> {
  const [facilities, settings] = await Promise.all([routeFacilities(), getOrgSettings()]);
  const ids = new Set(facilities.map((f) => f.id));
  const stored = settings.stockRoutes as StockRoute[] | null;
  if (Array.isArray(stored)) {
    const routes = stored.filter((r) => r && typeof r.from === "string" && typeof r.to === "string" && ids.has(r.from) && ids.has(r.to) && r.from !== r.to);
    return { facilities, routes, saved: true };
  }
  return { facilities, routes: await suggestedStockRoutes(facilities), saved: false };
}
