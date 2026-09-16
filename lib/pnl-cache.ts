import "server-only";
import { createHash } from "node:crypto";
import { prismaBase } from "@/lib/prisma-base";
import { getCurrentOrgId, runWithOrg } from "@/lib/tenant";
import { getOrgSettings } from "@/lib/settings";
import { getPnlHistory, pnlMeta, presentPnlChannels } from "@/lib/pnl";
import type { PnlHistory } from "@/lib/pnl-shared";

/**
 * The precomputed P&L history, and the rule that keeps it truthful.
 *
 * Building the history replays every sale through the cost engine (~5s for a company with a
 * couple of years of data), so it is computed once and stored (PnlSnapshot) under a FINGERPRINT
 * of everything it was computed from: for each table the statement reads, the company's row
 * count and the newest row version (Postgres' xmin — it moves on every insert and every update,
 * the count catches deletes), plus the settings that shape the figures. A page load recomputes
 * the fingerprint (one cheap statement) and serves the stored history only while it still
 * matches; the moment anything underneath changes, the next read rebuilds. The scheduler does
 * that rebuild in the background after data lands, so the page almost always finds a fresh one —
 * but it never serves one that doesn't match. There is no time-based expiry to reason about.
 */

/** Every tenant table the history is computed from (see getPnlHistory and the cost engine). */
const INPUT_TABLES = [
  "FinanceEvent",
  "SalesOrder",
  "SalesOrderLine",
  "OrderFee",
  "OrderFeeRule",
  "Product",
  "Lot",
  "LotLine",
  "LotMaterial",
  "Transaction",
  "TransactionInvoice",
  "Purchase",
  "PurchaseInvoice",
  "StockMovement",
  "Facility",
  "Integration",
  "MaterialType",
  "Settings",
] as const;

/** One statement: a change marker per input table, the company row itself, and the global FX table. */
export async function pnlFingerprint(orgId: string, tz: string): Promise<string> {
  const parts = INPUT_TABLES.map((t, i) => `(SELECT count(*)::text || ':' || COALESCE(max(xmin::text::bigint), 0)::text FROM "${t}" WHERE "orgId" = $1) AS t${i}`);
  parts.push(`(SELECT xmin::text || ':' || "currencyCode" FROM "Organization" WHERE id = $1) AS org`);
  parts.push(`(SELECT count(*)::text || ':' || COALESCE(max(xmin::text::bigint), 0)::text FROM "FxRate") AS fx`);
  const [row] = await prismaBase.$queryRawUnsafe<Record<string, string | null>[]>(`SELECT ${parts.join(", ")}`, orgId);
  return createHash("sha1").update(JSON.stringify({ ...row, tz, v: 1 })).digest("hex");
}

type Cached = Pick<PnlHistory, "days" | "lots" | "channels">;

/** The history for the current company: the stored one while its fingerprint holds, else rebuilt. */
export async function loadPnlHistory(tz: string): Promise<PnlHistory> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return getPnlHistory(tz);
  let fingerprint: string;
  try {
    const t0 = Date.now();
    fingerprint = await pnlFingerprint(orgId, tz);
    const t1 = Date.now();
    const snap = await prismaBase.pnlSnapshot.findUnique({ where: { orgId } });
    const t2 = Date.now();
    if (snap && snap.fingerprint === fingerprint) {
      const cached = snap.payload as unknown as Cached;
      const meta = await pnlMeta(tz);
      if (process.env.NODE_ENV === "development") console.log(`[pnl cache] hit — fingerprint ${t1 - t0}ms · read ${t2 - t1}ms · meta ${Date.now() - t2}ms`);
      return { ...cached, ...meta };
    }
    if (process.env.NODE_ENV === "development") console.log(`[pnl cache] miss — fingerprint ${t1 - t0}ms · read ${t2 - t1}ms`);
  } catch (e) {
    // The store is an accelerator, never a dependency: if it can't be read (a migration not yet
    // applied, a stale client), the page computes the statement directly, exactly as before.
    console.error("[pnl cache] snapshot unavailable, computing directly:", (e as Error).message);
    return getPnlHistory(tz);
  }
  return rebuildPnlSnapshot(orgId, tz, fingerprint);
}

/** Rebuild and store. The fingerprint is taken BEFORE computing: anything written meanwhile
 *  changes the next fingerprint, so a snapshot can never claim inputs it didn't see. */
async function rebuildPnlSnapshot(orgId: string, tz: string, fingerprint: string): Promise<PnlHistory> {
  const t0 = Date.now();
  const history = await getPnlHistory(tz);
  const payload: Cached = { days: history.days, lots: history.lots, channels: history.channels };
  try {
    await prismaBase.pnlSnapshot.upsert({
      where: { orgId },
      create: { orgId, fingerprint, payload: JSON.parse(JSON.stringify(payload)), computedAt: new Date(), durationMs: Date.now() - t0 },
      update: { fingerprint, payload: JSON.parse(JSON.stringify(payload)), computedAt: new Date(), durationMs: Date.now() - t0 },
    });
  } catch (e) {
    console.error("[pnl cache] snapshot not stored:", (e as Error).message);
  }
  return history;
}

const refreshing = new Set<string>();

/** Background pass (scheduler): rebuild a company's snapshot when its inputs changed since. */
export async function refreshPnlSnapshotIfStale(orgId: string): Promise<"fresh" | "rebuilt" | "skipped"> {
  if (refreshing.has(orgId)) return "skipped";
  refreshing.add(orgId);
  try {
    return await runWithOrg(orgId, async () => {
      if ((await presentPnlChannels()).length === 0) return "skipped"; // nothing to state yet
      const tz = (await getOrgSettings()).syncTz;
      const fingerprint = await pnlFingerprint(orgId, tz);
      const snap = await prismaBase.pnlSnapshot.findUnique({ where: { orgId }, select: { fingerprint: true } });
      if (snap?.fingerprint === fingerprint) return "fresh";
      await rebuildPnlSnapshot(orgId, tz, fingerprint);
      return "rebuilt";
    });
  } finally {
    refreshing.delete(orgId);
  }
}
