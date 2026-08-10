import "server-only";
import { prisma } from "@/lib/prisma";
import { ensureChannelFacilities } from "@/lib/integrations";
import { prismaBase } from "@/lib/prisma-base";
import { getCurrentOrgId } from "@/lib/tenant";
import { decryptSecret } from "@/lib/secret-box";
import { makeClient, getFbaInventory, getAwdInventory, getAllOrders } from "@/lib/spapi";

/** Units sold + days-with-sales over the last `n` days (kept for the stored rollups). */
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

/**
 * Sync every connected channel on demand: Amazon's full pull (stock AND the sales report) plus
 * the other channels' stock. This is what both manual buttons run, so "Sync channels" in Reorder
 * and "Run sync now" in Settings can never drift apart.
 *
 * Legs are independent — Shopify being down must not stop TikTok — and only Amazon counts toward
 * failure, because it alone carries the sales history the reorder engine needs.
 */
export async function syncAllChannelsCore(): Promise<{ synced: string[]; failed: string[]; salesOk: boolean }> {
  const { syncShopifyStock, syncTikTokStock } = await import("@/lib/channel-stock");
  const synced: string[] = [];
  const failed: string[] = [];

  const amazon = await syncAmazonCore().catch((e) => ({
    ok: false as const,
    error: e instanceof Error ? e.message : "Amazon sync failed.",
  }));
  if (amazon.ok) synced.push("Amazon");
  else if (!("nothingToSync" in amazon && amazon.nothingToSync)) failed.push("Amazon");

  for (const [label, run] of [
    ["Shopify", syncShopifyStock],
    ["TikTok", syncTikTokStock],
  ] as const) {
    try {
      const r = await run();
      if (r.facilities > 0) synced.push(label);
    } catch {
      failed.push(label);
    }
  }
  return { synced, failed, salesOk: amazon.ok ? amazon.salesOk : true };
}

/**
 * Refresh ONLY Amazon's stock numbers, leaving the sales figures untouched.
 *
 * Amazon's two halves have wildly different costs. Inventory is a plain API read that answers in
 * one round trip, so it can run as often as Shopify and TikTok do. Sales is a *report job* —
 * request it, poll for minutes, download a file, all under a tight quota — which is why the full
 * sync stays daily. Splitting them lets stock be near-live without touching the report at all.
 *
 * Updates the newest snapshot per SKU IN PLACE rather than appending. `getRestock` only ever reads
 * the newest row per product, so a new row every five minutes would add ~288 rows per SKU per day
 * that nothing reads, and slow the `distinct on` that finds the newest.
 *
 * Never flips the connection to "error": a blip on a five-minute loop would flap the status badge.
 * The daily sync is what judges the connection's health.
 */
export async function syncAmazonStockCore(): Promise<{ ok: true; count: number } | { ok: false; error: string; nothingToSync?: true }> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return { ok: false, error: "No organization in context.", nothingToSync: true };

  const conn = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn?.refreshTokenEnc) return { ok: false, error: "Amazon isn't connected.", nothingToSync: true };

  const products = await prisma.product.findMany({ where: { asin: { not: null } } });
  if (products.length === 0) return { ok: false, error: "No SKUs are mapped to Amazon ASINs yet.", nothingToSync: true };

  const client = makeClient({
    refreshToken: decryptSecret(conn.refreshTokenEnc),
    marketplaceId: conn.marketplaceId ?? "ATVPDKIKX0DER",
    region: conn.region ?? "na",
  });
  const inv = await getFbaInventory(client);
  const awd = await getAwdInventory(client);

  const latest = await prisma.skuSnapshot.findMany({ distinct: ["productId"], orderBy: { capturedAt: "desc" } });
  const latestByProduct = new Map(latest.map((s) => [s.productId, s]));

  let count = 0;
  for (const p of products) {
    const row = inv.find((x) => x.asin === p.asin) ?? inv.find((x) => x.sellerSku === p.sellerSku);
    const a = awd.find((x) => x.sku === p.sellerSku);
    const stock = {
      fbaAvailable: row?.available ?? 0,
      fbaInbound: row?.inbound ?? 0,
      fbaReserved: row ? Math.max(0, row.total - row.available - row.inbound) : 0,
      fbaUnfulfillable: row?.unfulfillable ?? 0,
      fbaTotal: row?.total ?? 0,
      awdOnhand: a?.onhand ?? 0,
      awdInbound: a?.inbound ?? 0,
      inStock: (row?.available ?? 0) > 0,
    };
    // capturedAt moves with the refresh: it drives the "Updated …" label, and after a stock pull
    // the units on screen genuinely are current. The sales half keeps its own anchor in `salesEnd`.
    const existing = latestByProduct.get(p.id);
    if (existing) await prisma.skuSnapshot.update({ where: { id: existing.id }, data: { ...stock, capturedAt: new Date() } });
    // No snapshot yet means the daily sync has never run for this SKU — seed one with zero sales
    // so its stock is visible immediately; the daily run fills the sales side in.
    else await prisma.skuSnapshot.create({ data: { productId: p.id, dailySales: {}, ...stock } });
    count++;
  }
  return { ok: true, count };
}

/**
 * Pull FBA + AWD inventory + per-day sales (All Orders) for the CURRENT org and store a fresh
 * snapshot per SKU. Each org syncs its OWN Amazon connection (the encrypted token on its
 * Integration row) — no shared env token, no owner guard. Runs in the caller's org context
 * (a request, or runWithOrg from the scheduler). Pure core: no request-scoped revalidate.
 */
export async function syncAmazonCore(): Promise<
  { ok: true; count: number; salesOk: boolean } | { ok: false; error: string; nothingToSync?: true }
> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return { ok: false, error: "No organization in context.", nothingToSync: true };

  const conn = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn?.refreshTokenEnc) {
    return { ok: false, error: "Amazon isn't connected for this company yet.", nothingToSync: true };
  }

  const products = await prisma.product.findMany({ where: { asin: { not: null } } });
  if (products.length === 0) {
    // Not a failure — there is simply nothing to pull. Flagged so the scheduler counts the day
    // as done instead of retrying (and logging an error) every five minutes.
    return { ok: false, error: "No SKUs are mapped to Amazon ASINs yet.", nothingToSync: true };
  }

  const client = makeClient({
    refreshToken: decryptSecret(conn.refreshTokenEnc),
    marketplaceId: conn.marketplaceId ?? "ATVPDKIKX0DER",
    region: conn.region ?? "na",
  });

  let inv, awd;
  try {
    inv = await getFbaInventory(client);
    awd = await getAwdInventory(client);
  } catch (e) {
    const msg = (e as Error).message;
    await prismaBase.integration.update({ where: { id: conn.id }, data: { status: "error", lastError: msg.slice(0, 300) } });
    return { ok: false, error: `Amazon inventory pull failed: ${msg}` };
  }

  // Sales lag ~2 days; pull 90 days of per-day orders, fall back to the last snapshot on failure.
  const end = new Date(Date.now() - 2 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 19) + "Z";
  let orders: Record<string, Record<string, number>> = {};
  let salesOk = true;
  try {
    orders = await getAllOrders(client, iso(new Date(end.getTime() - 90 * 86_400_000)), iso(end));
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
      dailySales: (salesOk ? days ?? {} : (last?.dailySales ?? {})) as object,
      salesEnd: salesOk ? end : last?.salesEnd ?? end,
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
  // Keep the locked channel facilities present (idempotent). Best-effort — must never fail the sync.
  try {
    await ensureChannelFacilities("amazon");
  } catch {
    /* facilities will appear on the next successful sync */
  }
  // Record the successful sync on the connection (clears any prior error / re-marks connected).
  await prismaBase.integration.update({
    where: { id: conn.id },
    data: { lastSyncAt: new Date(), status: "connected", lastError: null },
  });
  return { ok: true, count: rows.length, salesOk };
}
