import "server-only";
import { prisma } from "@/lib/prisma";
import { getRestock } from "@/lib/restock";

/**
 * The sales-channel integration registry — the single source for what can be connected and what
 * it materialises as. Connecting a provider creates one LOCKED facility per channel it exposes
 * (Amazon → FBA + AWD), so channel stock has a real "place" in the facility model. Locked
 * facilities can't be edited or deleted in-app; disconnecting is the only thing that may ever
 * remove them (future work — they carry movement history, so likely they just unlock).
 *
 * Today only Amazon is live, via the workspace's own API keys (no per-tenant OAuth yet). The
 * OAuth flow, when it lands on the Integrations page, calls the same ensureChannelFacilities()
 * on connect — everything downstream (guards, pickers, facility pages) is already channel-aware.
 */
export type Provider = "amazon" | "shopify" | "tiktok";

export const PROVIDERS: Record<
  Provider,
  {
    label: string;
    blurb: string;
    facilities: { channel: string; code: string; name: string }[];
    /** Provider whose facilities are discovered from the platform (one per store location) rather
     *  than being a fixed set — nothing to pre-create on connect. `channel` names the tag those
     *  discovered facilities carry, since there's no fixed `facilities` entry to read it from. */
    locationBased?: boolean;
    channel?: string;
  }
> = {
  amazon: {
    label: "Amazon",
    blurb: "Live FBA & AWD stock, sales velocity and restock recommendations via SP-API.",
    facilities: [
      { channel: "AMAZON_FBA", code: "FBA", name: "Amazon FBA" },
      { channel: "AMAZON_AWD", code: "AWD", name: "Amazon AWD" },
    ],
  },
  shopify: {
    label: "Shopify",
    blurb: "Orders and inventory for your own storefront.",
    // Discovered per store location by syncShopifyLocations() — one facility per real place,
    // so restocking can be judged per selling facility. Amazon-MCF locations are skipped: that
    // stock is the FBA pool, already counted from Amazon itself.
    facilities: [],
    locationBased: true,
    channel: "SHOPIFY",
  },
  tiktok: {
    label: "TikTok Shop",
    blurb: "Orders and inventory for your TikTok Shop.",
    // Discovered per sales warehouse by syncTikTokWarehouses() — one facility per real place,
    // matched by TikTok's warehouse id. Return warehouses are skipped: they hold no sellable stock.
    facilities: [],
    locationBased: true,
    channel: "TIKTOK",
  },
};

/**
 * Platform mark per channel — static app assets, keyed by channel rather than stored per facility,
 * so every location a provider discovers later carries its logo automatically with nothing to
 * backfill. The marks sit on a white tile: Amazon's are supplied on white, so this keeps them
 * identical in light and dark themes.
 */
export const CHANNEL_LOGO: Record<string, string> = {
  AMAZON_FBA: "/integrations/amazon-fba.png",
  AMAZON_AWD: "/integrations/amazon-awd.png",
  SHOPIFY: "/integrations/shopify.png",
  TIKTOK: "/integrations/tiktok.png",
};

/** Flat channel → display name map, for labelling a facility's origin anywhere in the UI.
 *  Covers both fixed channel facilities and location-based providers' own channel tag. */
export const CHANNEL_PROVIDER: Record<string, Provider> = Object.fromEntries(
  (Object.keys(PROVIDERS) as Provider[]).flatMap((p) => [
    ...PROVIDERS[p].facilities.map((f) => [f.channel, p] as [string, Provider]),
    ...(PROVIDERS[p].channel ? [[PROVIDERS[p].channel!, p] as [string, Provider]] : []),
  ]),
);

/**
 * Idempotently materialise a provider's locked channel facilities for the current org.
 * Called on every successful sync today, and by the OAuth connect flow tomorrow — safe to call
 * as often as you like. An existing facility that already claims the channel is re-locked if
 * someone managed to unlock it; a physical facility squatting on the code keeps its code and the
 * channel facility takes a suffixed one.
 */
export type ChannelStockRow = {
  productId: string;
  code: string;
  name: string;
  imageUrl: string | null;
  facilityId: string;
  facilityCode: string;
  facilityName: string;
  channel: string;
  units: number;
  value: number;
};

/**
 * Finished inventory HELD BY the connected channels, per SKU × channel facility — the platform's
 * own reported stock (FBA/AWD snapshots), valued at cost the same way the dashboard values it
 * (newest-shipment-first). Shaped like getFinishedStock().rows so channel facilities slot into
 * every finished-stock view like any other facility. Empty until the channel facilities exist.
 */
export async function getChannelStock(): Promise<{ rows: ChannelStockRow[]; totalUnits: number; totalValue: number }> {
  const facilities = await prisma.facility.findMany({ where: { channel: { not: null } } });
  if (facilities.length === 0) return { rows: [], totalUnits: 0, totalValue: 0 };
  // Amazon's units come off its own snapshot; Shopify/TikTok cells arrive already valued from
  // their channel's layer pool (starting balance + recorded shipments) — see lib/restock.ts.
  const { rows: restock, channelStock } = await getRestock();
  const products = await prisma.product.findMany({ select: { id: true, code: true, name: true, imageUrl: true } });
  const productById = new Map(products.map((p) => [p.id, p]));

  const rows: ChannelStockRow[] = [];
  for (const f of facilities) {
    if (f.channel === "AMAZON_FBA" || f.channel === "AMAZON_AWD") {
      const fba = f.channel === "AMAZON_FBA";
      for (const r of restock) {
        const units = fba ? r.fbaTotal : r.awdTotal;
        if (units <= 0) continue;
        rows.push({
          productId: r.id,
          code: r.code,
          name: r.name,
          imageUrl: r.imageUrl,
          facilityId: f.id,
          facilityCode: f.code,
          facilityName: f.name,
          channel: f.channel!,
          units,
          value: fba ? r.fbaValue : r.awdValue,
        });
      }
      continue;
    }
    // A Shopify/TikTok product needs no ASIN — read the valued cells, not the Amazon rows.
    for (const v of channelStock) {
      if (v.facilityId !== f.id || v.units <= 0) continue;
      const p = productById.get(v.productId);
      rows.push({
        productId: v.productId,
        code: p?.code ?? "?",
        name: p?.name ?? "",
        imageUrl: p?.imageUrl ?? null,
        facilityId: f.id,
        facilityCode: f.code,
        facilityName: f.name,
        channel: f.channel!,
        units: v.units,
        value: v.value,
      });
    }
  }
  rows.sort((a, b) => b.value - a.value);
  return {
    rows,
    totalUnits: rows.reduce((s, r) => s + r.units, 0),
    totalValue: rows.reduce((s, r) => s + r.value, 0),
  };
}

export async function ensureChannelFacilities(provider: Provider): Promise<void> {
  for (const spec of PROVIDERS[provider].facilities) {
    const existing = await prisma.facility.findFirst({ where: { channel: spec.channel } });
    if (existing) {
      if (!existing.locked) await prisma.facility.update({ where: { id: existing.id }, data: { locked: true } });
      continue;
    }
    const codeTaken = await prisma.facility.findFirst({ where: { code: spec.code } });
    await prisma.facility.create({
      data: {
        code: codeTaken ? `${spec.code}-CH` : spec.code,
        name: spec.name,
        type: "channel",
        channel: spec.channel,
        locked: true,
        notes: null,
      },
    });
  }
}
