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
      const due = s.syncHour * 60 + s.syncMinute;
      if (minutes < due) return; // not yet time today
      if (s.lastSyncRun === day) return; // already ran today (cheap pre-check)
      if (!(await claimDay(orgId, day))) return; // another replica got there first

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
    });
  } catch (e) {
    console.error(`[scheduler] channel stock errored for org ${orgId}:`, (e as Error).message);
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
  // Every 5 min: Shopify/TikTok stock refreshes on each tick, while the DB day-claim keeps the
  // heavier Amazon report pull to once per day.
  const TICK_MS = 5 * 60 * 1000;
  setInterval(() => void tick().catch(() => {}), TICK_MS);
  setTimeout(() => void tick().catch(() => {}), 30_000); // catch-up shortly after boot
  console.log("[scheduler] daily sync scheduler started");
}
