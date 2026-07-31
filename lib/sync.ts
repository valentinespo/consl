import "server-only";
import { prisma } from "@/lib/prisma";
import { ensureChannelFacilities } from "@/lib/integrations";
import { prismaBase } from "@/lib/prisma-base";
import { getCurrentOrgId } from "@/lib/tenant";
import { getFbaInventory, getAwdInventory, getAllOrders } from "@/lib/spapi";

/**
 * Interim guard until Amazon credentials move onto the Organization (the Integrations tab).
 *
 * SP-API keys currently come from server-wide env vars, so every org's sync would pull from the
 * SAME Amazon seller account. Since ASINs are public, another tenant could map one of ours and
 * receive our FBA quantities and 90 days of sales in their own snapshots. Only one org may sync
 * against the shared account:
 *   - SPAPI_ORG_ID set  → exactly that org (explicit, correct).
 *   - SPAPI_ORG_ID unset → fall back to the OLDEST org (the original seller). This fails safe: a
 *     forgotten env var restricts sync to the founding account instead of opening it to everyone,
 *     so a newly-created company still can't pull the seller's data. The fallback is cached for
 *     the process so it isn't a query per sync.
 */
let cachedOwnerOrgId: string | null | undefined;
async function syncOwnerOrgId(): Promise<string | null> {
  const explicit = process.env.SPAPI_ORG_ID;
  if (explicit) return explicit;
  if (cachedOwnerOrgId === undefined) {
    const first = await prismaBase.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    cachedOwnerOrgId = first?.id ?? null;
  }
  return cachedOwnerOrgId;
}
async function orgMaySync(): Promise<boolean> {
  const owner = await syncOwnerOrgId();
  if (!owner) return false; // no orgs at all — nothing may sync
  return (await getCurrentOrgId()) === owner;
}

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
 * Pull FBA + AWD inventory + per-day sales (All Orders) and store a fresh snapshot per SKU.
 * Pure core with no request-scoped calls (revalidate) — safe to run from the background scheduler.
 */
export async function syncAmazonCore(): Promise<
  { ok: true; count: number; salesOk: boolean } | { ok: false; error: string; nothingToSync?: true }
> {
  if (!(await orgMaySync())) {
    return {
      ok: false,
      error: "Amazon isn't connected for this workspace yet.",
      nothingToSync: true,
    };
  }
  const products = await prisma.product.findMany({ where: { asin: { not: null } } });
  if (products.length === 0) {
    // Not a failure — there is simply nothing to pull. Flagged so the scheduler counts the day
    // as done instead of retrying (and logging an error) every five minutes.
    return { ok: false, error: "No SKUs are mapped to Amazon ASINs yet.", nothingToSync: true };
  }

  let inv, awd;
  try {
    inv = await getFbaInventory();
    awd = await getAwdInventory();
  } catch (e) {
    return { ok: false, error: `Amazon inventory pull failed: ${(e as Error).message}` };
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
  // A working Amazon connection materialises its locked channel facilities (FBA/AWD) — the same
  // call the per-tenant OAuth connect flow will make once the Integrations page goes live.
  // Best-effort: a hiccup here must never fail the sync itself.
  try {
    await ensureChannelFacilities("amazon");
  } catch {
    /* facilities will appear on the next successful sync */
  }
  return { ok: true, count: rows.length, salesOk };
}
