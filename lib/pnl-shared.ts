/**
 * Client-safe P&L vocabulary — the shapes and labels both the server aggregation (lib/pnl.ts)
 * and the client statement (components/PnlClient.tsx) speak. No server imports here.
 */

/**
 * Where a line's money comes from: a channel's own ledger (Amazon's money report, Shopify's
 * orders and Payments ledger, TikTok's settlements), an ad platform, a fee the operator set up
 * in consl, or consl's own costing engine. A line that mixes sources carries all of them.
 */
export type PnlSource = "AMAZON" | "SHOPIFY" | "TIKTOK" | "AMAZON_ADS" | "META" | "CUSTOM" | "CONSL";
export const PNL_SOURCE_ORDER: PnlSource[] = ["AMAZON", "SHOPIFY", "TIKTOK", "AMAZON_ADS", "META", "CUSTOM", "CONSL"];
export const PNL_SOURCE_LABEL: Record<PnlSource, string> = {
  AMAZON: "From Amazon's money report",
  SHOPIFY: "From Shopify",
  TIKTOK: "From TikTok Shop",
  AMAZON_ADS: "From Amazon Ads",
  META: "From Meta Ads",
  CUSTOM: "A fee you set up in consl",
  CONSL: "Computed by consl",
};

export type PnlTypeRow = { type: string; amount: number; sources: PnlSource[] };
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
  /** Units sold from orders at no facility: priced at the product's average cost (part of `cogs`) until the order is placed. */
  unplaced: { units: number; cogs: number };
  /** Amazon MCF orders counted here (Amazon is the only channel): their units and cost, part of `cogs`. */
  mcf: { units: number; cogs: number };
  /** Amazon orders that shipped but Amazon posted no money for (free units, replacements): units from the Orders tab, part of `cogs`. */
  unreported: { units: number; cogs: number };
  /** Listings sold on a channel that the company doesn't manage in consl — left out entirely. */
  ignored: { skus: string[]; units: number; sales: number };
  /** Kept for callers that only ask yes/no: an Amazon ledger walk is running (`importProgress` says which and how far). */
  backfillInProgress: boolean;
  /** The running Amazon ledger walk: the first history import, or a re-read with a newer importer. Null = none. */
  importProgress: {
    phase: "history" | "reread";
    /** The day the walk has reached (it walks backwards from today), YYYY-MM-DD. */
    reached: string;
    /** 0–100 of the way from today back to Amazon's two-year floor. */
    percent: number;
    /** No window has completed for half an hour — the scheduler keeps retrying. */
    stalled: boolean;
  } | null;
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
