import "server-only";
import { prisma } from "@/lib/prisma";
import { tiktokApi, TIKTOK_API_VERSION } from "@/lib/tiktok";

/**
 * TikTok Shop warehouses → consl facilities.
 *
 * A TikTok "warehouse" is a real place stock sits, which is exactly what a Facility is — so each
 * one becomes its own locked facility, the same way Shopify locations do. Only enabled
 * SALES_WAREHOUSEs are imported: a RETURN_WAREHOUSE holds no sellable stock (it's where rejects
 * land), so importing it would invent inventory the shop can't ship from.
 */

type TikTokWarehouse = {
  id: string;
  entity_id?: string;
  name: string;
  type: string; // "SALES_WAREHOUSE" | "RETURN_WAREHOUSE"
  sub_type?: string;
  effect_status: string; // "ENABLED" | …
  is_default?: boolean;
  address?: {
    full_address?: string | null;
    city?: string | null;
    state?: string | null;
    region_code?: string | null;
    postal_code?: string | null;
  } | null;
};

/** A short, pill-sized code from a warehouse name: "Herbl East Coast Hub" → "HERBL". */
export function codeFromWarehouseName(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const firstAlpha = words.find((w) => /^[A-Z]/.test(w));
  return (firstAlpha ?? words[0] ?? "TTS").slice(0, 6);
}

/** A free code for a new facility, suffixing on collision (…, HERBL2, HERBL3). */
async function freeCode(base: string): Promise<string> {
  let code = base;
  for (let n = 2; await prisma.facility.findFirst({ where: { code }, select: { id: true } }); n++) {
    code = `${base}${n}`.slice(0, 8);
  }
  return code;
}

export type WarehouseSyncResult = {
  created: number;
  updated: number;
  retired: number;
};

/**
 * Materialise the shop's sales warehouses as facilities. Idempotent — safe on every connect and
 * sync. Warehouses are matched by TikTok's warehouse id (`externalId`), so a rename over there
 * updates the facility instead of duplicating it.
 */
export async function syncTikTokWarehouses(accessToken: string, shopCipher: string): Promise<WarehouseSyncResult> {
  const data = await tiktokApi<{ warehouses: TikTokWarehouse[] }>({
    method: "GET",
    path: `/logistics/${TIKTOK_API_VERSION}/warehouses`,
    accessToken,
    query: { shop_cipher: shopCipher },
  });
  const all = data.warehouses ?? [];
  const wanted = all.filter((w) => w.type === "SALES_WAREHOUSE" && w.effect_status === "ENABLED");

  const existing = await prisma.facility.findMany({ where: { channel: "TIKTOK" } });
  const byExternal = new Map(existing.filter((f) => f.externalId).map((f) => [f.externalId!, f]));

  let created = 0;
  let updated = 0;
  const seen = new Set<string>();

  for (const w of wanted) {
    seen.add(w.id);
    const name = w.name;
    const address =
      w.address?.full_address?.trim() ||
      [w.address?.city, w.address?.state, w.address?.region_code, w.address?.postal_code].filter(Boolean).join(", ");
    const match = byExternal.get(w.id);
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
        code: await freeCode(codeFromWarehouseName(w.name)),
        name,
        type: "channel",
        channel: "TIKTOK",
        externalId: w.id,
        locked: true,
        address: address || null,
      },
    });
    created++;
  }

  // A warehouse that vanished or was disabled is RETIRED, never deleted — it can carry lots and
  // movements, and losing that history would be worse than a stale row.
  let retired = 0;
  for (const f of existing) {
    if (!f.externalId || seen.has(f.externalId) || f.inactive) continue;
    await prisma.facility.update({ where: { id: f.id }, data: { inactive: true } });
    retired++;
  }

  return { created, updated, retired };
}
