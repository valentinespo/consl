import "server-only";
import { prisma } from "@/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopify";

/**
 * Shopify locations → consl facilities.
 *
 * A Shopify "location" is a real place stock sits, which is exactly what a Facility is — so each
 * one becomes its own locked facility rather than everything collapsing into one "Shopify" bag.
 * That's what makes per-facility restocking meaningful: you can only fulfil a store's orders from
 * the place that actually holds its stock.
 *
 * The one thing we must NOT import is a location that merely mirrors stock consl already counts
 * from the platform itself — Amazon MCF, whose Shopify location reflects the FBA pool we read
 * straight from SP-API. Importing it would double-count every FBA unit. Any OTHER fulfilment
 * service (ShipBob, a 3PL app, print-on-demand) is real stock we have no other source for, so it
 * becomes a facility like any warehouse.
 */

type ShopifyLocation = {
  id: string;
  name: string;
  isActive: boolean;
  isFulfillmentService: boolean;
  fulfillmentService: { handle: string | null; serviceName: string | null } | null;
  address: { address1: string | null; city: string | null; provinceCode: string | null; countryCode: string | null } | null;
};

// `includeLegacy` is essential: fulfilment-service locations (the MCF one) are invisible without
// it, so we would never even see the location we most need to exclude.
const LOCATIONS_QUERY = `{
  locations(first: 100, includeInactive: true, includeLegacy: true) {
    nodes {
      id
      name
      isActive
      isFulfillmentService
      fulfillmentService { handle serviceName }
      address { address1 city provinceCode countryCode }
    }
  }
}`;

/** True when this location is Amazon's own fulfilment mirror (MCF) — the FBA pool by another name. */
export function isAmazonMirror(loc: Pick<ShopifyLocation, "name" | "isFulfillmentService" | "fulfillmentService">): boolean {
  if (!loc.isFulfillmentService) return false;
  const hay = `${loc.fulfillmentService?.handle ?? ""} ${loc.fulfillmentService?.serviceName ?? ""} ${loc.name}`.toLowerCase();
  return hay.includes("amazon");
}

/** A short, pill-sized code from a location name: "638 Alton Place" → "ALTON". */
export function codeFromLocationName(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const firstAlpha = words.find((w) => /^[A-Z]/.test(w));
  return (firstAlpha ?? words[0] ?? "SHOP").slice(0, 6);
}

/** The headline for the facility: its street address when Shopify has one, else the location name. */
function displayName(loc: ShopifyLocation): string {
  return loc.address?.address1?.trim() || loc.name;
}

/** A free code for a new facility, suffixing on collision (…, ALTON2, ALTON3). */
async function freeCode(base: string): Promise<string> {
  let code = base;
  for (let n = 2; await prisma.facility.findFirst({ where: { code }, select: { id: true } }); n++) {
    code = `${base}${n}`.slice(0, 8);
  }
  return code;
}

export type LocationSyncResult = {
  created: number;
  updated: number;
  retired: number;
  skippedMcf: string[]; // names, so the UI can say what was deliberately left out
};

/**
 * Materialise the shop's locations as facilities. Idempotent — safe on every connect and sync.
 * `amazonConnected` gates the MCF skip: with no Amazon connection there's no other source for
 * that stock, so the location is imported like any other rather than silently vanishing.
 */
export async function syncShopifyLocations(
  shop: string,
  accessToken: string,
  opts: { amazonConnected: boolean },
): Promise<LocationSyncResult> {
  const data = await shopifyGraphQL<{ locations: { nodes: ShopifyLocation[] } }>(shop, accessToken, LOCATIONS_QUERY);
  const all = data.locations.nodes;

  const skippedMcf: string[] = [];
  const wanted = all.filter((loc) => {
    if (opts.amazonConnected && isAmazonMirror(loc)) {
      skippedMcf.push(loc.name);
      return false;
    }
    return loc.isActive; // a deactivated location holds no stock; it retires below if we had one
  });

  const existing = await prisma.facility.findMany({ where: { channel: "SHOPIFY" } });
  const byExternal = new Map(existing.filter((f) => f.externalId).map((f) => [f.externalId!, f]));

  let created = 0;
  let updated = 0;
  const seen = new Set<string>();

  for (const loc of wanted) {
    seen.add(loc.id);
    const name = displayName(loc);
    const address = [loc.address?.address1, loc.address?.city, loc.address?.provinceCode, loc.address?.countryCode]
      .filter(Boolean)
      .join(", ");
    const match = byExternal.get(loc.id);
    if (match) {
      // Match on the platform's id, never the name — so renames follow instead of duplicating.
      if (match.name !== name || match.inactive || match.address !== (address || null) || !match.locked) {
        await prisma.facility.update({
          where: { id: match.id },
          data: { name, address: address || null, inactive: false, locked: true },
        });
        updated++;
      }
      continue;
    }
    await prisma.facility.create({
      data: {
        code: await freeCode(codeFromLocationName(loc.name)),
        name,
        type: "channel",
        channel: "SHOPIFY",
        externalId: loc.id,
        locked: true,
        address: address || null,
      },
    });
    created++;
  }

  // A location that vanished or was deactivated is RETIRED, never deleted — it can carry lots and
  // movements, and losing that history would be worse than a stale row.
  let retired = 0;
  for (const f of existing) {
    if (!f.externalId || seen.has(f.externalId) || f.inactive) continue;
    await prisma.facility.update({ where: { id: f.id }, data: { inactive: true } });
    retired++;
  }

  return { created, updated, retired, skippedMcf };
}
