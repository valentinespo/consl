"use server";

import { prisma } from "@/lib/prisma";
import { getFbaInventory, getSalesUnits } from "@/lib/spapi";
import { revalidatePath } from "next/cache";

/** Pull FBA inventory + trailing sales from Amazon and store a fresh snapshot per SKU. */
export async function syncAmazon() {
  const products = await prisma.product.findMany({ where: { asin: { not: null } } });
  if (products.length === 0) return { ok: false as const, error: "No SKUs are mapped to Amazon ASINs yet." };

  let inv;
  try {
    inv = await getFbaInventory();
  } catch (e) {
    return { ok: false as const, error: `Amazon inventory pull failed: ${(e as Error).message}` };
  }

  // Sales report lags ~2 days; pull 90 + 30 day windows, fall back to the last snapshot on failure.
  const end = new Date(Date.now() - 2 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 19) + "Z";
  let sales90: Record<string, number> = {};
  let sales30: Record<string, number> = {};
  let salesOk = true;
  try {
    sales90 = await getSalesUnits(iso(new Date(end.getTime() - 90 * 86_400_000)), iso(end));
    sales30 = await getSalesUnits(iso(new Date(end.getTime() - 30 * 86_400_000)), iso(end));
  } catch {
    salesOk = false;
  }

  // Latest previous snapshot per product (fallback for sales).
  const prev = await prisma.skuSnapshot.findMany({ distinct: ["productId"], orderBy: { capturedAt: "desc" } });
  const prevByProduct = new Map(prev.map((s) => [s.productId, s]));

  const rows = products.map((p) => {
    const row = inv!.find((x) => x.asin === p.asin) ?? inv!.find((x) => x.sellerSku === p.sellerSku);
    const last = prevByProduct.get(p.id);
    return {
      productId: p.id,
      fbaAvailable: row?.available ?? 0,
      fbaInbound: row?.inbound ?? 0,
      fbaReserved: row?.reserved ?? 0,
      fbaUnfulfillable: row?.unfulfillable ?? 0,
      fbaTotal: row?.total ?? 0,
      units90d: salesOk ? (sales90[p.asin!] ?? 0) : (last?.units90d ?? 0),
      units30d: salesOk ? (sales30[p.asin!] ?? 0) : (last?.units30d ?? 0),
    };
  });
  await prisma.skuSnapshot.createMany({ data: rows });
  revalidatePath("/inventory");
  return { ok: true as const, count: rows.length, salesOk };
}
