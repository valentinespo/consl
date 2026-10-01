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
  CUSTOM: "A fee or credit you set up in consl",
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
  /** Stock that left without a sale or came back, part of `cogs`: units and cost of the removal
   *  orders, the lost & destroyed, the found & returned, and the write-offs (see PnlStock). */
  stk?: number[];
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
  /** Ledger money of this day that the statement neither counted nor named a reason for leaving
   *  out. Never expected: the page shows it and the build logs it when it isn't zero. */
  gap?: number;
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
  /** Amazon Ads has data on this statement but its connection is down (expired sign-in, or
   *  disconnected): balance-paid invoices still count, the daily split and card-paid spend wait. */
  adsReconnect?: boolean;
};
export const sourceBits = (sources: PnlSource[]) => sources.reduce((bits, s) => bits | (1 << PNL_SOURCE_ORDER.indexOf(s)), 0);
export const sourcesFromBits = (bits: number): PnlSource[] => PNL_SOURCE_ORDER.filter((_, i) => bits & (1 << i));
export type PnlStatement = Pick<Pnl, "groups" | "sales" | "cogs" | "unitsSold" | "netProfit" | "margin" | "roi" | "mcf" | "unreported" | "stock">;

/** One Cost of goods line beside the units sold: units (signed: − left, + came back) and cost. */
export type PnlStockLine = { units: number; cogs: number };
/** Stock that left without a sale or came back, inside Cost of goods. Amazon's (lib/amazon-stock-
 *  events): removal orders; lost & destroyed (lost in the warehouse or on the way in, destroyed,
 *  taken out by Amazon); found & returned (found, credited back, customer returns back in stock).
 *  The company's own (Movements): write-offs — lost raw materials, finished goods written off or
 *  sent out as samples — split across channels by units sold. */
export type PnlStock = { removals: PnlStockLine; lost: PnlStockLine; back: PnlStockLine; writeoffs: PnlStockLine };
export const PNL_STOCK_LINES = ["removals", "lost", "back", "writeoffs"] as const;
export const PNL_STOCK_LABEL: Record<(typeof PNL_STOCK_LINES)[number], string> = {
  removals: "Removal orders",
  lost: "Lost & destroyed",
  back: "Found & returned",
  writeoffs: "Write-offs",
};
export const emptyPnlStock = (): PnlStock => ({ removals: { units: 0, cogs: 0 }, lost: { units: 0, cogs: 0 }, back: { units: 0, cogs: 0 }, writeoffs: { units: 0, cogs: 0 } });
export const pnlStockTotal = (s: PnlStock) => s.removals.cogs + s.lost.cogs + s.back.cogs + s.writeoffs.cogs;
export type PnlPeriod = PnlPeriodRange & { statement: PnlStatement };

export type Pnl = {
  groups: PnlGroupBlock[];
  sales: number;
  cogs: number; // negative (an expense), 0 when nothing shipped — the units sold plus `stock`
  unitsSold: number;
  /** Amazon stock that left without a sale or came back — part of `cogs`. */
  stock: PnlStock;
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
  /** Ledger money in the window on no line of the statement and with no rule naming why (a
   *  listing not managed, a duplicate of another channel's order, an ad row the invoice fill
   *  replaces). Zero unless the statement's rules drifted; the page says so when it isn't. */
  ledgerGap: number;
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
  /** Amazon Ads feeds this statement but needs a reconnect (shown while Amazon is in view). */
  adsReconnect?: boolean;
  hasData: boolean;
};

/**
 * The statement's order. Sales and the refunds against them make Net sales; Cost of goods (which
 * the UI inserts) and the cost of delivering every order (the channel's fulfillment, referral,
 * payment, storage and custom fees) come off it for Gross profit; then advertising, everything
 * else, and the taxes that only pass through, down to Net profit.
 */
export const GROUP_ORDER = ["sales", "refunds", "fba_fees", "referral_fees", "payment_fees", "storage_fees", "custom_fees", "advertising", "other", "taxes"] as const;
export const PNL_REVENUE_GROUPS: readonly string[] = ["sales", "refunds"];
export const PNL_DELIVERY_GROUPS: readonly string[] = ["fba_fees", "referral_fees", "payment_fees", "storage_fees", "custom_fees"];

/** A statement's subtotals: Net sales (sales less refunds) and Gross profit (net sales less cost
 *  of goods and the cost of delivery). The UI reads each, like the margin, against sales. */
export function pnlSubtotals(s: PnlStatement): { netSales: number; grossProfit: number } {
  const total = (group: string) => s.groups.find((b) => b.group === group)?.total ?? 0;
  const netSales = PNL_REVENUE_GROUPS.reduce((t, g) => t + total(g), 0);
  return { netSales, grossProfit: netSales + s.cogs + PNL_DELIVERY_GROUPS.reduce((t, g) => t + total(g), 0) };
}

/** One grouped line of a section: a plain name over the platforms' own lines it gathers. */
export type PnlLine = { line: string; amount: number; sources: PnlSource[]; types: PnlTypeRow[] };

/** Amazon's reimbursement reasons arrive as codes: MISSING_FROM_INBOUND, WAREHOUSE_LOST… */
const REIMBURSEMENT_CODE = /^[A-Z0-9]+(_[A-Z0-9]+)+$/;

/**
 * The grouped line a platform's own line sits under: plain names that read the same for every
 * channel — "Product sales" holds Amazon's Principal, Shopify's product sales and TikTok's gross
 * sales. Naming only: every platform line stays one click deeper with its own amount, and no
 * section, amount or total moves. A line the rules don't know lands in its section's catch-all.
 */
export function pnlLineOf(group: string, type: string, sources: PnlSource[]): string {
  const custom = sources.length > 0 && sources.every((x) => x === "CUSTOM");
  const only = (source: "AMAZON" | "TIKTOK") => sources.length > 0 && sources.every((x) => x === source || (source === "AMAZON" && x === "AMAZON_ADS"));
  const base = type.replace(/ \((pending|not invoiced yet)\)$/i, "");
  const t = base.toLowerCase();
  switch (group) {
    case "sales":
      if (custom) return "Credits you added";
      if (/principal|product sales|gross sales/.test(t)) return "Product sales";
      if (/discount|promotion|coupon|voucher/.test(t)) return "Discounts";
      if (/shipping|gift ?wrap/.test(t)) return "Shipping & gift wrap";
      return "Other sales";
    case "refunds":
      if (t === "chargeback" || t.startsWith("chargeback:")) return "Chargebacks";
      if (/refundcommission|refund administration/.test(t)) return "Refund admin fees";
      if (!/customer|buyer/.test(t) && (/:tax$/.test(t) || /commission|chargeback|digitalservices|closingfee|fulfillment|referral/.test(t))) return "Fees given back";
      return "Refunded to customers";
    case "taxes":
      // What customers paid; what the channel paid to the state for you (Amazon, TikTok, Shopify on
      // Shop app orders), taken out of the payout; and what you still owe the state yourself (your
      // own store's tax) — the one the balance sheet carries as sales tax payable.
      if (/withheld|facilitator|payment/.test(t)) return "Tax paid by the channel";
      if (/owed|remitted/.test(t)) return "Tax owed";
      return "Tax collected";
    case "fba_fees":
      if (t.startsWith("mcf:")) return "MCF fulfillment";
      if (t.endsWith("chargeback")) return "Shipping charged back";
      if (/inbound|placement/.test(t)) return "Inbound shipping & placement";
      if (/upstream|\bawd\b/.test(t)) return "AWD processing & transport";
      if (/removal|disposal|liquidation/.test(t)) return "Removals & disposal";
      return only("AMAZON") ? "FBA fulfillment" : "Shipping & fulfillment";
    case "referral_fees":
      return "Referral fees";
    case "payment_fees":
      if (custom) return "Fees you added";
      return t.includes("chargeback") ? "Chargeback fees" : "Processing fees";
    case "custom_fees":
      return custom ? "Fees you added" : "Other fees";
    case "storage_fees":
      if (/star|upstream|\bawd\b/.test(t)) return "AWD storage";
      return only("AMAZON") ? "FBA storage" : "Storage";
    case "advertising":
      if (t.includes("sponsored products")) return "Sponsored Products";
      if (t.includes("sponsored brands")) return "Sponsored Brands";
      if (t.includes("sponsored display")) return "Sponsored Display";
      if (/sponsored ads|productadspayment/.test(t)) return "Amazon ads";
      if (t.includes("vine")) return "Amazon Vine";
      if (sources.includes("META") || t.includes("meta")) return "Meta ads";
      if (only("TIKTOK")) {
        if (/affiliate|creator|dynamic commission/.test(t)) return "TikTok affiliates";
        if (/promotion|campaign/.test(t)) return "TikTok promotions";
        return "TikTok ads";
      }
      if (t.includes("creator")) return "Creator Connections";
      return "Other advertising";
    case "other":
      if (t.includes("subscription")) return "Seller subscription";
      if (only("AMAZON") && REIMBURSEMENT_CODE.test(base)) return "Amazon reimbursements";
      return "Other adjustments";
    default:
      return "Other";
  }
}

/** A section's lines under their grouped names, biggest first; each keeps its platform lines, biggest first. */
export function pnlLines(block: PnlGroupBlock): PnlLine[] {
  const lines = new Map<string, PnlLine>();
  for (const t of block.types) {
    const name = pnlLineOf(block.group, t.type, t.sources);
    const line = lines.get(name) ?? { line: name, amount: 0, sources: [], types: [] };
    line.amount += t.amount;
    line.sources = PNL_SOURCE_ORDER.filter((x) => line.sources.includes(x) || t.sources.includes(x));
    line.types.push(t);
    lines.set(name, line);
  }
  const big = (a: { amount: number }, b: { amount: number }) => Math.abs(b.amount) - Math.abs(a.amount);
  return [...lines.values()].map((l) => ({ ...l, types: [...l.types].sort(big) })).sort(big);
}

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
