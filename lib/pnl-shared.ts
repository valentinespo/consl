/**
 * Client-safe P&L vocabulary — the shapes and labels both the server aggregation (lib/pnl.ts)
 * and the client statement (components/PnlClient.tsx) speak. No server imports here.
 */

export type PnlTypeRow = { type: string; amount: number };
export type PnlGroupBlock = { group: string; total: number; types: PnlTypeRow[] };

export type Pnl = {
  groups: PnlGroupBlock[];
  sales: number;
  cogs: number; // negative (an expense), 0 when nothing shipped
  unitsSold: number;
  netProfit: number;
  margin: number | null; // netProfit / sales
  roi: number | null; // netProfit / |cogs|
  /** Revenue included from orders Amazon hasn't settled yet (exact split; fees estimated). */
  pendingSales: number;
  unmatchedSkus: string[]; // managed SKUs with no cost yet — their units are NOT in cogs
  /** Listings sold on the channel that the company doesn't manage in consl — left out entirely. */
  ignored: { skus: string[]; units: number; sales: number };
  backfillInProgress: boolean;
  hasData: boolean;
};

/** Sellerise-shaped ordering; "sales" first, computed COGS is inserted by the UI right after. */
export const GROUP_ORDER = ["sales", "taxes", "fba_fees", "referral_fees", "storage_fees", "advertising", "refunds", "other"] as const;

export const GROUP_LABEL: Record<string, string> = {
  sales: "Sales",
  taxes: "Taxes",
  fba_fees: "FBA fees",
  referral_fees: "Referral fees",
  storage_fees: "Storage fees",
  advertising: "Advertising",
  refunds: "Refunds",
  other: "Other Amazon transactions",
};
