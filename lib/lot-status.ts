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
  PARTIAL: "Partial",
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
