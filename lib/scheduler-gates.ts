import "server-only";

/**
 * The scheduler's per-company clocks: when each pass last ran (in-process; a restart simply runs
 * everything again). Kept apart from the scheduler so a connect flow can clear a company's clocks
 * without importing the scheduler itself: the next tick — within a minute — then runs every pass
 * at once, so a freshly connected channel starts loading right away instead of waiting out the
 * quarter-hour cadence.
 */
export const lastDailyAttempt = new Map<string, number>();
export const lastPlacesRefresh = new Map<string, number>();
export const lastOrdersRefresh = new Map<string, number>();
export const lastTikTokFinance = new Map<string, number>();
export const lastMfnShipFromStep = new Map<string, number>();
export const lastAmazonPoll = new Map<string, number>();
export const lastAmazonOrderHeal = new Map<string, number>();
export const lastAmazonOrderAudit = new Map<string, number>();
export const lastAmazonOrderReport = new Map<string, number>();
export const lastAmazonFinanceSweep = new Map<string, number>();
export const lastAmazonAdsTick = new Map<string, number>();
export const lastMetaAdsTick = new Map<string, number>();

/** Forget a company's clocks: every pass is due on the next tick. Call it when a connection lands. */
export function nudgeOrgImports(orgId: string): void {
  for (const clock of [lastDailyAttempt, lastPlacesRefresh, lastOrdersRefresh, lastTikTokFinance, lastMfnShipFromStep, lastAmazonPoll, lastAmazonOrderHeal, lastAmazonOrderAudit, lastAmazonOrderReport, lastAmazonFinanceSweep, lastAmazonAdsTick, lastMetaAdsTick]) {
    clock.delete(orgId);
  }
}
