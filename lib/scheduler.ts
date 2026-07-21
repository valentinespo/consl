import "server-only";
import { prisma } from "@/lib/prisma";
import { syncAmazonCore } from "@/lib/sync";
import { getRestock } from "@/lib/restock";

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

/** One scheduler tick: run the daily Amazon sync + value snapshot if due and not yet done today. */
async function tick(): Promise<void> {
  if (running) return;
  const s = await prisma.settings.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {} });
  if (!s.syncEnabled) return;
  const { day, minutes } = nowInTz(s.syncTz);
  const due = s.syncHour * 60 + s.syncMinute;
  if (minutes < due) return; // not yet time today
  if (s.lastSyncRun === day) return; // already ran today
  running = true;
  try {
    await syncAmazonCore(); // refresh Amazon FBA/AWD/sales
    await getRestock(); // computes + records today's inventory-value snapshot with fresh numbers
    await prisma.settings.update({ where: { id: "singleton" }, data: { lastSyncRun: day, lastSyncAt: new Date() } });
    console.log(`[scheduler] daily sync completed for ${day}`);
  } catch (e) {
    // Leave lastSyncRun unset so the next tick retries.
    console.error("[scheduler] daily sync failed:", (e as Error).message);
  } finally {
    running = false;
  }
}

let started = false;

/** Start the in-process daily scheduler. Safe to call multiple times (starts once). */
export function startDailyScheduler(): void {
  if (started) return;
  started = true;
  const TICK_MS = 5 * 60 * 1000; // check every 5 min; the DB guard keeps it once-per-day
  setInterval(() => void tick().catch(() => {}), TICK_MS);
  setTimeout(() => void tick().catch(() => {}), 30_000); // catch-up shortly after boot
  console.log("[scheduler] daily sync scheduler started");
}
