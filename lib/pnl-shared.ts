/**
 * Client-safe P&L vocabulary — the shapes and labels both the server aggregation (lib/pnl.ts)
 * and the client statement (components/PnlClient.tsx) speak. No server imports here.
 */

export type PnlTypeRow = { type: string; amount: number };
export type PnlGroupBlock = { group: string; total: number; types: PnlTypeRow[] };

export type PnlChannel = "AMAZON" | "SHOPIFY" | "TIKTOK";
export const PNL_CHANNEL_LABEL: Record<PnlChannel, string> = { AMAZON: "Amazon", SHOPIFY: "Shopify", TIKTOK: "TikTok" };

export type Pnl = {
  groups: PnlGroupBlock[];
  sales: number;
  cogs: number; // negative (an expense), 0 when nothing shipped
  unitsSold: number;
  netProfit: number;
  margin: number | null; // netProfit / sales
  roi: number | null; // netProfit / |cogs|
  /** Revenue included from orders a channel hasn't posted yet (exact split; fees estimated). */
  pending: { channel: PnlChannel; sales: number }[];
  unmatchedSkus: string[]; // managed SKUs with no cost yet — their units are NOT in cogs
  /** Units sold before the product's first recorded layer — priced at its pre-consl average cost. */
  preHistoryUnits: number;
  /** Units sold beyond everything recorded as shipped — priced at the newest cost on record. */
  overflowUnits: number;
  /** Units sold from orders not placed at any facility — they carry no cost until they are. */
  unplacedUnits: number;
  /** Amazon MCF orders counted here (Amazon is the only channel): their units and cost, part of `cogs`. */
  mcf: { units: number; cogs: number };
  /** Listings sold on a channel that the company doesn't manage in consl — left out entirely. */
  ignored: { skus: string[]; units: number; sales: number };
  backfillInProgress: boolean;
  hasData: boolean;
};

/** Sellerise-shaped ordering; "sales" first, computed COGS is inserted by the UI right after. */
export const GROUP_ORDER = ["sales", "taxes", "fba_fees", "referral_fees", "payment_fees", "custom_fees", "storage_fees", "advertising", "refunds", "other"] as const;

export const GROUP_LABEL: Record<string, string> = {
  sales: "Sales",
  taxes: "Taxes",
  fba_fees: "FBA fees",
  referral_fees: "Referral fees",
  payment_fees: "Payment processing",
  custom_fees: "Custom fees",
  storage_fees: "Storage fees",
  advertising: "Advertising",
  refunds: "Refunds",
  other: "Other transactions",
};
