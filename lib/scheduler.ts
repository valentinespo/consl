import "server-only";
import { prismaBase } from "@/lib/prisma-base";
import { runWithOrg } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { getOrgSettings, saveOrgSettings } from "@/lib/settings";
import { syncAmazonCore, syncAmazonStockCore } from "@/lib/sync";
import { syncShopifyStock, syncTikTokStock } from "@/lib/channel-stock";
import { getRestock } from "@/lib/restock";
import { deleteStored } from "@/lib/storage";
import { DELETE_GRACE_DAYS } from "@/lib/constants";

/** Current date + minute-of-day in a given IANA timezone. */
function nowInTz(tz: string): { day: string; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return { day: `${m.year}-${m.month}-${m.day}`, minutes: (Number(m.hour) % 24) * 60 + Number(m.minute) };
  } catch {
    const d = new Date();
    return { day: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
  }
}

/**
 * The overnight minute this org's Amazon sales report runs at, in its own timezone.
 *
 * Derived from the org id rather than chosen by the customer: the report only covers days up to
 * ~48h old, so the hour cannot change a single figure — there is nothing to tune, and asking is
 * just a setting to get wrong. Spreading orgs deterministically across a three-hour window also
 * stops every tenant hammering the platforms in the same minute as the customer base grows.
 */
function nightlySlotMinutes(orgId: string): number {
  let h = 0;
  for (let i = 0; i < orgId.length; i++) h = (h * 31 + orgId.charCodeAt(i)) >>> 0;
  return 2 * 60 + (h % 180); // 02:00–04:59, local to the org's timezone
}

let running = false;

/**
 * Claim today's run for an org, atomically. `running` above only guards one process, and reading
 * `lastSyncRun` then writing it minutes later is a race: two replicas would both see "not run
 * yet", both pull from Amazon, and both write a full set of snapshots — doubling the day's
 * numbers and burning the report quota twice. A conditional update lets exactly one win.
 */
async function claimDay(orgId: string, day: string): Promise<boolean> {
  const { count } = await prismaBase.settings.updateMany({
    where: { orgId, NOT: { lastSyncRun: day } },
    data: { lastSyncRun: day },
  });
  return count === 1;
}

/** Run the daily sync for one org if it's due and hasn't run today (in that org's own context). */
async function runOrgDaily(orgId: string): Promise<void> {
  // The whole body is guarded: a failure reading settings used to escape and unwind the caller's
  // loop, so every org after the failing one was silently skipped — on every tick, forever.
  try {
    await runWithOrg(orgId, async () => {
      const s = await getOrgSettings();
      if (!s.syncEnabled) return;
      const { day, minutes } = nowInTz(s.syncTz);
      if (minutes < nightlySlotMinutes(orgId)) return; // not yet this org's slot today
      if (s.lastSyncRun === day) return; // already ran today (cheap pre-check)
      if (!(await claimDay(orgId, day))) return; // another replica got there first

      // Self-healing webhook registration: (re)subscribe this environment's URL for the org's
      // shop. Idempotent; also how production registers itself after a promote.
      try {
        const { ensureShopifyWebhooks } = await import("@/lib/shopify-webhooks");
        await ensureShopifyWebhooks();
      } catch (e) {
        console.error(`[scheduler] shopify webhook ensure failed for org ${orgId}:`, (e as Error).message);
      }

      const r = await syncAmazonCore(); // no-op for orgs with no Amazon-mapped SKUs
      await getRestock(); // records today's inventory-value snapshot with fresh numbers

      if (r.ok) {
        await saveOrgSettings({ lastSyncAt: new Date() });
        console.log(`[scheduler] daily sync completed for org ${orgId} (${day})`);
      } else if (r.nothingToSync) {
        // No Amazon connection or no mapped SKUs — the day is genuinely done, not failed.
        console.log(`[scheduler] nothing to sync for org ${orgId} (${day}): ${r.error}`);
      } else {
        // Release the claim so the next tick retries rather than waiting until tomorrow, and
        // leave `lastSyncAt` alone — otherwise a failed pull reads as "synced just now".
        await prismaBase.settings.updateMany({ where: { orgId }, data: { lastSyncRun: null } });
        console.error(`[scheduler] daily sync failed for org ${orgId}: ${r.error}`);
      }
    });
  } catch (e) {
    console.error(`[scheduler] daily sync errored for org ${orgId}:`, (e as Error).message);
    await prismaBase.settings.updateMany({ where: { orgId }, data: { lastSyncRun: null } }).catch(() => {});
  }
}

/**
 * Refresh stock from every connected channel — Amazon included. Runs on EVERY tick, not once a
 * day, because stock everywhere is a plain API read that answers in one round trip.
 *
 * What stays daily is Amazon's SALES half: a report job you request, poll for minutes, then
 * download, under a tight quota. `syncAmazonStockCore` deliberately skips it, which is what lets
 * Amazon's stock keep pace with Shopify's and TikTok's.
 *
 * Deliberately does not record a value snapshot: that belongs to the daily run, and this loop
 * fires often enough that re-costing the whole catalogue each time would be wasted work.
 *
 * Isolated three ways — a bad org can't stop other orgs, and a bad channel can't stop the other
 * channels or the daily sync.
 */
async function runOrgChannelStock(orgId: string): Promise<void> {
  try {
    await runWithOrg(orgId, async () => {
      const s = await getOrgSettings();
      if (!s.syncEnabled) return;
      const conns = await prisma.integration.findMany({
        where: { provider: { in: ["amazon", "shopify", "tiktok"] }, status: "connected" },
        select: { provider: true },
      });
      for (const c of conns) {
        try {
          if (c.provider === "amazon") {
            await syncAmazonStockCore();
            continue;
          }
          const r = c.provider === "shopify" ? await syncShopifyStock() : await syncTikTokStock();
          if (r.skipped > 0) {
            console.log(`[scheduler] ${c.provider} stock for org ${orgId}: ${r.skipped} quantities skipped (unmapped SKU or warehouse)`);
          }
        } catch (e) {
          console.error(`[scheduler] ${c.provider} stock failed for org ${orgId}:`, (e as Error).message);
        }
      }

      // Recent ORDERS refresh: pull the last few days from Shopify + TikTok every quarter hour, so
      // new sales, edits and cancellations land without anyone pressing the button. A 3-day window
      // re-covers late edits; the upsert makes re-pulls free. Amazon's recent orders ride on the
      // daily sync (they come from the slow report and lag ~2 days anyway) — and the platforms
      // TELLING us instead (webhooks) is the profit-tracking build, not this loop.
      const last = lastOrdersRefresh.get(orgId) ?? 0;
      if (Date.now() - last >= ORDERS_REFRESH_MS) {
        lastOrdersRefresh.set(orgId, Date.now());
        const { importShopifyOrders, importTikTokOrders } = await import("@/lib/orders");
        for (const [provider, run] of [
          ["shopify", () => importShopifyOrders(3)],
          ["tiktok", () => importTikTokOrders(3)],
        ] as const) {
          if (!conns.some((c) => c.provider === provider)) continue;
          try {
            await run();
          } catch (e) {
            console.error(`[scheduler] ${provider} orders failed for org ${orgId}:`, (e as Error).message);
          }
        }
      }

      // Amazon's near-real-time leg: a cursored sweep of the live Orders API every few minutes.
      // Amazon has no plain webhooks (their push needs AWS queues), so this poll IS the instant
      // path for Amazon; Shopify and TikTok get true webhooks and use this loop only as backstop.
      if (conns.some((c) => c.provider === "amazon")) {
        const lastPoll = lastAmazonPoll.get(orgId) ?? 0;
        if (Date.now() - lastPoll >= AMAZON_POLL_MS) {
          lastAmazonPoll.set(orgId, Date.now());
          try {
            const { pollAmazonOrders } = await import("@/lib/orders");
            const r = await pollAmazonOrders();
            if (r.orders > 0) console.log(`[scheduler] amazon live orders for ${orgId}: ${r.orders} updated`);
          } catch (e) {
            console.error(`[scheduler] amazon orders poll failed for org ${orgId}:`, (e as Error).message);
          }
        }

        // The report-based correction pass, every 6 hours: one 3-day All-Orders report that fills
        // in what the live poll can't — line-level revenue, MCF/replacement flags, and totals the
        // API hid while Pending. Four report requests a day sits far inside the quota; running it
        // more often would mostly re-read the same file (the report lags hours at the source).
        const lastReport = lastAmazonOrderReport.get(orgId) ?? 0;
        if (Date.now() - lastReport >= AMAZON_ORDER_REPORT_MS) {
          lastAmazonOrderReport.set(orgId, Date.now());
          try {
            const { importAmazonOrders } = await import("@/lib/orders");
            const r = await importAmazonOrders(3);
            console.log(`[scheduler] amazon order report refresh for ${orgId}: ${r.orders} orders`);
          } catch (e) {
            console.error(`[scheduler] amazon order report failed for org ${orgId}:`, (e as Error).message);
          }
        }
      }
    });
  } catch (e) {
    console.error(`[scheduler] channel stock errored for org ${orgId}:`, (e as Error).message);
  }
}

const ORDERS_REFRESH_MS = 15 * 60 * 1000;
const AMAZON_POLL_MS = 5 * 60 * 1000;
const AMAZON_ORDER_REPORT_MS = 6 * 60 * 60 * 1000;
// In-process per-org timestamps; a restart just refreshes once immediately, which is harmless.
const lastOrdersRefresh = new Map<string, number>();
const lastAmazonPoll = new Map<string, number>();
const lastAmazonOrderReport = new Map<string, number>();

let backfilling = false;

/**
 * Walk each org's Amazon order history backward, one window per pass, until it reaches the report's
 * ~2-year retention floor. Runs on its OWN loop with its own guard — decoupled from the 1-minute
 * stock tick so a slow order report (minutes) never stalls stock freshness, and serialized so we
 * never fire more Amazon reports than the quota allows. Once every org's cursor hits the floor this
 * does nothing, so it's self-terminating after the initial backfill.
 */
async function backfillTick(): Promise<void> {
  if (backfilling) return;
  backfilling = true;
  try {
    const orgs = await prismaBase.organization.findMany({ where: { deactivatedAt: null }, select: { id: true } });
    for (const orgId of orgs.map((o) => o.id)) {
      try {
        await runWithOrg(orgId, async () => {
          const s = await getOrgSettings();
          if (!s.syncEnabled) return;
          const conn = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" }, select: { id: true } });
          if (!conn) return;
          const { backfillAmazonOrdersStep } = await import("@/lib/orders");
          const r = await backfillAmazonOrdersStep();
          if (r.imported > 0) console.log(`[scheduler] amazon order backfill for ${orgId}: +${r.imported} (cursor ${r.cursor}${r.done ? ", done" : ""})`);
        });
      } catch (e) {
        console.error(`[scheduler] backfill failed for org ${orgId}:`, (e as Error).message);
      }
    }
  } catch (e) {
    console.error("[scheduler] backfill tick failed:", (e as Error).message);
  } finally {
    backfilling = false;
  }
}

/**
 * Permanently delete companies whose grace period has elapsed. Deleting an org cascades across
 * every tenant table (verified), but stored files live outside the database, so gather and remove
 * those first. Best-effort per org: one failure must not stop the rest or the sync loop.
 */
async function purgeExpiredOrgs(): Promise<void> {
  const cutoff = new Date(Date.now() - DELETE_GRACE_DAYS * 86_400_000);
  const expired = await prismaBase.organization.findMany({
    where: { deactivatedAt: { not: null, lt: cutoff } },
    select: { id: true, name: true, logoUrl: true, iconUrl: true },
  });
  for (const org of expired) {
    try {
      // Collect every stored-file URL this org owns, then delete the files (best-effort).
      const urls: (string | null)[] = [org.logoUrl, org.iconUrl];
      await runWithOrg(org.id, async () => {
        const [docs, products, materials, suppliers, pos] = await Promise.all([
          prisma.document.findMany({ select: { fileUrl: true } }),
          prisma.product.findMany({ select: { imageUrl: true } }),
          prisma.materialType.findMany({ select: { imageUrl: true } }),
          prisma.supplier.findMany({ select: { photoUrl: true } }),
          prisma.purchaseOrder.findMany({ select: { pdfUrl: true } }),
        ]);
        urls.push(
          ...docs.map((d) => d.fileUrl),
          ...products.map((p) => p.imageUrl),
          ...materials.map((m) => m.imageUrl),
          ...suppliers.map((s) => s.photoUrl),
          ...pos.map((p) => p.pdfUrl),
        );
      });
      await Promise.allSettled(urls.map((u) => deleteStored(u)));
      // Then the rows — the cascade removes everything that belongs to the org.
      await prismaBase.organization.delete({ where: { id: org.id } });
      console.log(`[scheduler] purged expired company ${org.name} (${org.id})`);
    } catch (e) {
      console.error(`[scheduler] purge failed for org ${org.id}:`, (e as Error).message);
    }
  }
}

/** One scheduler tick: purge expired companies, refresh every org's channel stock, then run each
 *  live org's daily sync if it's due. */
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await purgeExpiredOrgs();
    // Only live orgs sync; a deactivated one is on its way out.
    const orgs = await prismaBase.organization.findMany({ where: { deactivatedAt: null }, select: { id: true } });
    // One org's failure must never stop the others; both helpers swallow their own errors.
    await Promise.allSettled(orgs.map((o) => runOrgChannelStock(o.id)));
    await Promise.allSettled(orgs.map((o) => runOrgDaily(o.id)));
  } catch (e) {
    console.error("[scheduler] tick failed:", (e as Error).message);
  } finally {
    running = false;
  }
}

let started = false;

/** Start the in-process daily scheduler. Safe to call multiple times (starts once). */
export function startDailyScheduler(): void {
  if (started) return;
  started = true;
  // Every minute: stock refreshes on each tick, while the DB day-claim keeps the heavier Amazon
  // report pull to once per day. Stock reads are single round trips well inside every platform's
  // rate limit at this cadence — but that budget is PER TENANT, so this interval will need to
  // become a stagger (or a per-org offset) once many companies are connected.
  const TICK_MS = 60 * 1000;
  setInterval(() => void tick().catch(() => {}), TICK_MS);
  setTimeout(() => void tick().catch(() => {}), 30_000); // catch-up shortly after boot
  // The Amazon order backfill runs on its own guarded loop so a slow order report never stalls the
  // stock tick; it self-terminates once every org has walked back to the retention floor.
  setInterval(() => void backfillTick().catch(() => {}), TICK_MS);
  setTimeout(() => void backfillTick().catch(() => {}), 45_000);
  console.log("[scheduler] daily sync scheduler started");
}
