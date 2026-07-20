"use server";

import { prisma } from "@/lib/prisma";
import { getFbaInventory, getAwdInventory, getSalesUnits } from "@/lib/spapi";
import { revalidatePath } from "next/cache";

/** Pull FBA + AWD inventory + trailing sales (10/30/90d) from Amazon and store a fresh snapshot per SKU. */
export async function syncAmazon() {
  const products = await prisma.product.findMany({ where: { asin: { not: null } } });
  if (products.length === 0) return { ok: false as const, error: "No SKUs are mapped to Amazon ASINs yet." };

  let inv, awd;
  try {
    inv = await getFbaInventory();
    awd = await getAwdInventory();
  } catch (e) {
    return { ok: false as const, error: `Amazon inventory pull failed: ${(e as Error).message}` };
  }

  // Sales report lags ~2 days; pull 90/30/10 day windows, fall back to the last snapshot on failure.
  const end = new Date(Date.now() - 2 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 19) + "Z";
  const win = (days: number) => getSalesUnits(iso(new Date(end.getTime() - days * 86_400_000)), iso(end));
  let sales90: Record<string, number> = {};
  let sales30: Record<string, number> = {};
  let sales10: Record<string, number> = {};
  let salesOk = true;
  try {
    sales90 = await win(90);
    sales30 = await win(30);
    sales10 = await win(10);
  } catch {
    salesOk = false;
  }

  const prev = await prisma.skuSnapshot.findMany({ distinct: ["productId"], orderBy: { capturedAt: "desc" } });
  const prevByProduct = new Map(prev.map((s) => [s.productId, s]));

  const rows = products.map((p) => {
    const row = inv!.find((x) => x.asin === p.asin) ?? inv!.find((x) => x.sellerSku === p.sellerSku);
    const a = awd!.find((x) => x.sku === p.sellerSku);
    const last = prevByProduct.get(p.id);
    return {
      productId: p.id,
      fbaAvailable: row?.available ?? 0,
      fbaInbound: row?.inbound ?? 0,
      fbaReserved: row ? Math.max(0, row.total - row.available - row.inbound) : 0, // reserved + in-transit + researching
      fbaUnfulfillable: row?.unfulfillable ?? 0,
      fbaTotal: row?.total ?? 0,
      awdOnhand: a?.onhand ?? 0,
      awdInbound: a?.inbound ?? 0,
      units90d: salesOk ? (sales90[p.asin!] ?? 0) : (last?.units90d ?? 0),
      units30d: salesOk ? (sales30[p.asin!] ?? 0) : (last?.units30d ?? 0),
      units10d: salesOk ? (sales10[p.asin!] ?? 0) : (last?.units10d ?? 0),
    };
  });
  await prisma.skuSnapshot.createMany({ data: rows });
  revalidatePath("/inventory");
  return { ok: true as const, count: rows.length, salesOk };
}
