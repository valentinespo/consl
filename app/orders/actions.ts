"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, requireView } from "@/lib/membership";
import { getOrgSettings, saveOrgSettings } from "@/lib/settings";
import { importAllOrders } from "@/lib/orders";

/** Pull orders from every connected channel into the store. Idempotent — safe to re-run; it
 *  backfills new orders and refreshes changed ones. Gated on inventory:edit like the other syncs. */
export async function importOrders() {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  try {
    const results = await importAllOrders();
    revalidatePath("/orders");
    const done = results.filter((r) => !r.error && r.orders > 0).map((r) => `${r.channel} ${r.orders}`);
    const failed = results.filter((r) => r.error).map((r) => r.channel);
    return {
      ok: failed.length === 0,
      summary: done.length ? done.join(", ") : "no new orders",
      error: failed.length ? `Some channels couldn't be reached.` : undefined,
    };
  } catch (e) {
    console.error("[importOrders]", e);
    return { ok: false as const, error: "The import couldn't complete. Please try again." };
  }
}

/** Toggle whether a mirrored Shopify source (e.g. "tiktok") is excluded from Shopify totals. */
export async function setSourceExcluded(source: string, excluded: boolean) {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const s = await getOrgSettings();
  const set = new Set(s.excludedShopifySources ?? []);
  if (excluded) set.add(source);
  else set.delete(source);
  await saveOrgSettings({ excludedShopifySources: [...set] });
  revalidatePath("/orders");
  return { ok: true as const };
}

/** Whether any channel is connected — controls whether the Orders tab offers an import. */
export async function anyChannelConnected() {
  await requireView("dashboard");
  const conns = await (await import("@/lib/prisma")).prisma.integration.count({
    where: { status: "connected", provider: { in: ["amazon", "shopify", "tiktok"] } },
  });
  return conns > 0;
}
