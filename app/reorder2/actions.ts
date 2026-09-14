"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/membership";
import { saveOrgSettings } from "@/lib/settings";
import { routeFacilities, suggestedStockRoutes, type StockRoute } from "@/lib/stock-routes";

/** Save the stock-routes grid (which facilities can send to which). */
export async function saveStockRoutes(routes: StockRoute[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  const ids = new Set((await routeFacilities()).map((f) => f.id));
  const clean = [...new Map(routes.filter((r) => ids.has(r.from) && ids.has(r.to) && r.from !== r.to).map((r) => [`${r.from}>${r.to}`, { from: r.from, to: r.to }])).values()];
  await saveOrgSettings({ stockRoutes: clean });
  revalidatePath("/reorder2");
  return { ok: true };
}

/** Back to the suggested set (own facilities to everything, AWD to FBA, every lane ever used). */
export async function resetStockRoutes(): Promise<{ ok: true; routes: StockRoute[] } | { ok: false; error: string }> {
  const gate = await requirePermission("inventory", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  const facilities = await routeFacilities();
  const routes = await suggestedStockRoutes(facilities);
  await saveOrgSettings({ stockRoutes: routes });
  revalidatePath("/reorder2");
  return { ok: true, routes };
}
