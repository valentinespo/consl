/**
 * Lot-level status is DERIVED from its SKU lines — one lot's SKUs finish (and get paid for) at
 * different times, so the lot only summarizes. Pure + client-safe: both the table pills and the
 * lot page's live header preview use it.
 *
 * Colours mirror each other across the two axes (per the founder):
 *   not started → violet (In production / Due) · partway → amber (Partially finished / Partial)
 *   · done → green (Finished / Fully paid).
 */

export type DerivedProduction = "IN_PRODUCTION" | "PARTIAL" | "FINISHED";
export type DerivedPayment = "DUE" | "PARTIAL" | "PAID";

export function deriveProduction(lines: { status: string }[]): DerivedProduction {
  if (lines.length === 0) return "IN_PRODUCTION";
  const finished = lines.filter((l) => l.status === "FINISHED").length;
  return finished === 0 ? "IN_PRODUCTION" : finished === lines.length ? "FINISHED" : "PARTIAL";
}

export function derivePayment(lines: { paymentStatus: string }[]): DerivedPayment {
  if (lines.length === 0) return "DUE";
  const paid = lines.filter((l) => l.paymentStatus === "PAID").length;
  return paid === 0 ? "DUE" : paid === lines.length ? "PAID" : "PARTIAL";
}

/** The day the lot truly completed: the LATEST line finished date, only when ALL are finished. */
export function deriveFinishedAt(lines: { status: string; finishedAt: Date | null }[]): Date | null {
  if (lines.length === 0 || lines.some((l) => l.status !== "FINISHED")) return null;
  let latest: Date | null = null;
  for (const l of lines) {
    if (l.finishedAt && (!latest || l.finishedAt > latest)) latest = l.finishedAt;
  }
  return latest;
}

export const PRODUCTION_LABEL: Record<DerivedProduction, string> = {
  IN_PRODUCTION: "In production",
  PARTIAL: "Partially finished",
  FINISHED: "Fully finished",
};
export const PAYMENT_LABEL: Record<DerivedPayment, string> = {
  DUE: "Due",
  PARTIAL: "Partially paid",
  PAID: "Fully paid",
};
/** Frosted pill class per derived value — violet → amber → green on both axes. */
export const DERIVED_PILL_CLS: Record<string, string> = {
  IN_PRODUCTION: "pill-chart",
  PARTIAL: "pill-amber",
  FINISHED: "pill-green",
  DUE: "pill-chart",
  PAID: "pill-green",
};

/** One-line explanation of each derived status — powers the "?" legends on the table headers. */
export const PRODUCTION_HELP: Record<DerivedProduction, string> = {
  IN_PRODUCTION: "None of the lot's SKUs are finished yet — still being made.",
  PARTIAL: "Some SKUs are finished, the rest are still in production.",
  FINISHED: "Every SKU in the lot is finished.",
};
export const PAYMENT_HELP: Record<DerivedPayment, string> = {
  DUE: "Nothing on this lot has been paid for yet.",
  PARTIAL: "Some SKUs are paid, the rest are still due.",
  PAID: "Every SKU in the lot has been paid.",
};
/** Legend order — violet → amber → green, matching the pills. */
export const PRODUCTION_ORDER: DerivedProduction[] = ["IN_PRODUCTION", "PARTIAL", "FINISHED"];
export const PAYMENT_ORDER: DerivedPayment[] = ["DUE", "PARTIAL", "PAID"];

const DAYS_PER_MONTH = 30.44;

/**
 * How far a still-running lot is through its expected production window: elapsed time since the
 * PO date over the configured lead time. 100% is the day it was due, so past that the figure keeps
 * climbing (125% = a quarter of the lead time late) — which is what flags it overdue. Null when
 * there's nothing to measure against (no PO date, or no lead time configured).
 */
export function productionProgress(
  poDateISO: string | null,
  leadMonths: number | null | undefined,
  nowMs: number,
): { pct: number; overdue: boolean } | null {
  if (!poDateISO || !leadMonths || leadMonths <= 0) return null;
  const po = new Date(poDateISO).getTime();
  if (!Number.isFinite(po)) return null;
  const elapsedDays = (nowMs - po) / 86_400_000;
  if (elapsedDays < 0) return null; // a future-dated PO hasn't started
  const pct = Math.round((elapsedDays / (leadMonths * DAYS_PER_MONTH)) * 100);
  return { pct, overdue: pct > 100 };
}
