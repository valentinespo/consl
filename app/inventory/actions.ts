"use server";

import { prisma } from "@/lib/prisma";
import { getFbaInventory, getAwdInventory, getAllOrders } from "@/lib/spapi";
import { revalidatePath } from "next/cache";

/** Units sold + days-with-sales over the last `n` days (velocity denominator excludes stockout days). */
function windowStats(days: Record<string, number> | undefined, end: Date, n: number) {
  let units = 0;
  let salesDays = 0;
  if (days) {
    for (let i = 0; i < n; i++) {
      const d = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      const u = days[d] ?? 0;
      units += u;
      if (u > 0) salesDays++;
    }
  }
  return { units, salesDays };
}

/** Pull FBA + AWD inventory + per-day sales (All Orders report) and store a fresh snapshot per SKU. */
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

  // Sales lag ~2 days; pull 90 days of per-day orders, fall back to the last snapshot on failure.
  const end = new Date(Date.now() - 2 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 19) + "Z";
  let orders: Record<string, Record<string, number>> = {};
  let salesOk = true;
  try {
    orders = await getAllOrders(iso(new Date(end.getTime() - 90 * 86_400_000)), iso(end));
  } catch {
    salesOk = false;
  }

  const prev = await prisma.skuSnapshot.findMany({ distinct: ["productId"], orderBy: { capturedAt: "desc" } });
  const prevByProduct = new Map(prev.map((s) => [s.productId, s]));

  const rows = products.map((p) => {
    const row = inv!.find((x) => x.asin === p.asin) ?? inv!.find((x) => x.sellerSku === p.sellerSku);
    const a = awd!.find((x) => x.sku === p.sellerSku);
    const last = prevByProduct.get(p.id);
    const days = p.sellerSku ? orders[p.sellerSku] : undefined;
    const w = (n: number) => (salesOk ? windowStats(days, end, n) : null);
    const w10 = w(10);
    const w30 = w(30);
    const w90 = w(90);
    return {
      productId: p.id,
      fbaAvailable: row?.available ?? 0,
      fbaInbound: row?.inbound ?? 0,
      fbaReserved: row ? Math.max(0, row.total - row.available - row.inbound) : 0,
      fbaUnfulfillable: row?.unfulfillable ?? 0,
      fbaTotal: row?.total ?? 0,
      awdOnhand: a?.onhand ?? 0,
      awdInbound: a?.inbound ?? 0,
      inStock: (row?.available ?? 0) > 0,
      units10d: w10?.units ?? last?.units10d ?? 0,
      units30d: w30?.units ?? last?.units30d ?? 0,
      units90d: w90?.units ?? last?.units90d ?? 0,
      salesDays10: w10?.salesDays ?? last?.salesDays10 ?? 0,
      salesDays30: w30?.salesDays ?? last?.salesDays30 ?? 0,
      salesDays90: w90?.salesDays ?? last?.salesDays90 ?? 0,
    };
  });
  await prisma.skuSnapshot.createMany({ data: rows });
  revalidatePath("/inventory");
  return { ok: true as const, count: rows.length, salesOk };
}

/** Update the global default floor + lead time. */
export async function updateGlobalDefaults(minMonths: number, leadMonths: number) {
  await prisma.settings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", defaultMinMonths: minMonths, defaultLeadMonths: leadMonths },
    update: { defaultMinMonths: minMonths, defaultLeadMonths: leadMonths },
  });
  revalidatePath("/inventory");
  return { ok: true as const };
}

/** Set a per-SKU floor + lead override. Pass null to fall back to the global default. */
export async function updateSkuPolicy(productId: string, minMonths: number | null, leadMonths: number | null) {
  await prisma.product.update({ where: { id: productId }, data: { minMonths, leadMonths } });
  revalidatePath("/inventory");
  return { ok: true as const };
}

/** Set the inventory dashboard sort mode: "sales" | "available" | "manual". */
export async function setSortMode(mode: string) {
  await prisma.settings.upsert({ where: { id: "singleton" }, create: { id: "singleton", sortMode: mode }, update: { sortMode: mode } });
  revalidatePath("/inventory");
  return { ok: true as const };
}

/** Save a manual SKU order (array of product ids, top to bottom) and switch to manual sort. */
export async function saveManualOrder(orderedIds: string[]) {
  await prisma.$transaction([
    ...orderedIds.map((id, i) => prisma.product.update({ where: { id }, data: { sortIndex: i } })),
    prisma.settings.upsert({ where: { id: "singleton" }, create: { id: "singleton", sortMode: "manual" }, update: { sortMode: "manual" } }),
  ]);
  revalidatePath("/inventory");
  return { ok: true as const };
}
