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

export const PNL_BREAKDOWNS = [
  { value: "none", label: "No breakdown" },
  { value: "day", label: "By day" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
  { value: "quarter", label: "By quarter" },
  { value: "year", label: "By year" },
] as const;
export type PnlBreakdown = (typeof PNL_BREAKDOWNS)[number]["value"];

export function parsePnlBreakdown(value: string | undefined): PnlBreakdown {
  return PNL_BREAKDOWNS.find((option) => option.value === value)?.value ?? "none";
}

/** Company-calendar days: the full period and the portion inside the selected range. */
export type PnlPeriodRange = { key: string; start: string; end: string; from: string; to: string };

/**
 * One company-calendar day of the statement, compact for the wire. The server always sends the
 * selected range day by day; the browser folds days into weeks, months, quarters or years itself,
 * so switching the breakdown never goes back to the server. `rows` = [group, type, amount,
 * sources] with sources a bitmask over PNL_SOURCE_ORDER; days with nothing on them are omitted.
 */
export type PnlDay = {
  d: string;
  /** The channel this day's figures belong to — the browser sums the channels it's showing. */
  c: PnlChannel;
  rows: [string, string, number, number][];
  cogs: number;
  units: number;
  mcf: [number, number];
  unreported: [number, number];
  /** Units priced from lots not fully costed yet, their (negative) cost, and those lots' ids. */
  est?: [number, number, string[]];
  /** Units sold before the product's first recorded layer / beyond everything recorded shipped. */
  pre?: number;
  over?: number;
  /** Units from orders at no facility and their (negative) cost. */
  unpl?: [number, number];
  /** Managed SKUs sold with no cost on record. */
  unm?: string[];
  /** Listings sold that the company doesn't manage here: skus, units, sales. */
  ign?: [string[], number, number];
  /** Revenue from orders the channel hasn't posted the money for yet (already in `rows`). */
  pend?: number;
};

/**
 * The whole statement history, shipped once: every day of every channel since the first dated
 * money, plus what the browser needs to cut any window, channel mix or breakdown out of it
 * without another trip to the server.
 */
export type PnlHistory = {
  days: PnlDay[];
  /** Lots referenced by `est` on any day. */
  lots: { id: string; label: string }[];
  /** Channels with anything to show, in display order. */
  channels: PnlChannel[];
  /** Company-calendar bounds for the date picker: today, and the first dated money or order. */
  newest: string;
  oldest: string;
  /** The running Amazon ledger walk, when Amazon is connected (shown while Amazon is in view). */
  importProgress: Pnl["importProgress"];
  /** Channels whose first history pull hasn't finished, by channel. */
  importing: Partial<Record<PnlChannel, boolean>>;
};
export const sourceBits = (sources: PnlSource[]) => sources.reduce((bits, s) => bits | (1 << PNL_SOURCE_ORDER.indexOf(s)), 0);
export const sourcesFromBits = (bits: number): PnlSource[] => PNL_SOURCE_ORDER.filter((_, i) => bits & (1 << i));
export type PnlStatement = Pick<Pnl, "groups" | "sales" | "cogs" | "unitsSold" | "netProfit" | "margin" | "roi" | "mcf" | "unreported">;
export type PnlPeriod = PnlPeriodRange & { statement: PnlStatement };

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
  /** Units sold from lots not fully costed yet (part of `cogs`, at the latest paid lot's cost or the onboarding cost), and those lots. */
  estimated: { units: number; cogs: number; lots: { id: string; label: string }[] };
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
  /** Channels (labels) whose first history pull hasn't finished — figures fill in as it lands. */
  importing: string[];
  hasData: boolean;
};

/** Sellerise-shaped ordering; "sales" first, computed COGS is inserted by the UI right after. */
/** While false, a connected Amazon Ads account's daily spend is imported and stored but the
 *  statement does not read it: the ad invoice payments stay the amount on the P&L, exactly as
 *  before connecting. It flips to true together with the invoice water-fill (invoices stay the
 *  amount of record and the API's daily spend only shapes them). A plain switch date between
 *  invoice rows and daily rows would lose or double count part of a day, so there is none. */
export const AMAZON_ADS_DAILY_ON_PNL = false;

export const GROUP_ORDER = ["sales", "taxes", "fba_fees", "referral_fees", "payment_fees", "custom_fees", "storage_fees", "advertising", "refunds", "other"] as const;

export const GROUP_LABEL: Record<string, string> = {
  sales: "Sales",
  taxes: "Taxes",
  fba_fees: "Fulfillment fees",
  referral_fees: "Referral fees",
  payment_fees: "Payment processing",
  custom_fees: "Custom fees",
  storage_fees: "Storage fees",
  advertising: "Advertising",
  refunds: "Refunds",
  other: "Other transactions",
};
