/**
 * Next.js instrumentation: runs once when a server instance boots.
 * Starts the in-process daily scheduler (Amazon sync + inventory-value snapshot).
 * Production + Node runtime only — we don't auto-sync from local dev.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  const { startDailyScheduler } = await import("./lib/scheduler");
  startDailyScheduler();
}
