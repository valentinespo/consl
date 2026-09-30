/**
 * The Xero export's vocabulary, shared by the setup screen and the server (plain module, no
 * "server-only"). A company's consl P&L is a set of LINES per channel — the P&L's own groups plus
 * cost of goods — and each line posts to one Xero account. The money those lines move waits in
 * BALANCE rows until the cash moves: a clearing account per channel (payout deposits are coded
 * there), sales tax payable (the P&L's Taxes row: the state's money, never revenue), payables for
 * costs paid outside the channel, and inventory (cost of goods leaves it).
 */

export type XeroChannel = "AMAZON" | "SHOPIFY" | "TIKTOK";
export const CHANNEL_NAME: Record<XeroChannel, string> = { AMAZON: "Amazon", SHOPIFY: "Shopify", TIKTOK: "TikTok Shop" };
export const CHANNEL_ORDER: XeroChannel[] = ["AMAZON", "SHOPIFY", "TIKTOK"];

export type LineKey =
  | "sales"
  | "refunds"
  | "cogs"
  | "removals"
  | "referral_fees"
  | "fba_fees"
  | "payment_fees"
  | "storage_fees"
  | "custom_fees"
  | "advertising"
  | "other";

export type SectionKey = "revenue" | "goods" | "costs" | "marketing" | "other";
export const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "goods", label: "Cost of goods" },
  { key: "costs", label: "Selling costs" },
  { key: "marketing", label: "Marketing" },
  { key: "other", label: "Other" },
];

/** The new account consl proposes for a row: its base name (see newAccountName) and Xero type. */
export type Suggestion = { name: string; type: string };

/**
 * consl's accounts carry its name up front ("consl - Sales"), so they stand apart from the
 * company's own in Xero and never collide with them. Renaming can drop it.
 */
export const NEW_ACCOUNT_PREFIX = "consl - ";
export const newAccountName = (base: string) => `${NEW_ACCOUNT_PREFIX}${base}`;

export const LINES: Record<LineKey, { label: string; hint: string; section: SectionKey; suggest: Suggestion }> = {
  sales: { label: "Sales", hint: "What customers paid for your products.", section: "revenue", suggest: { name: "Sales", type: "REVENUE" } },
  refunds: { label: "Refunds", hint: "Money returned to customers.", section: "revenue", suggest: { name: "Refunds", type: "REVENUE" } },
  cogs: { label: "Cost of goods sold", hint: "The landed cost of every unit sold, from consl.", section: "goods", suggest: { name: "Cost of Goods Sold", type: "DIRECTCOSTS" } },
  removals: { label: "Removals & losses", hint: "Stock that left without a sale (removal orders, destroyed, lost), less what came back.", section: "goods", suggest: { name: "Inventory Losses", type: "DIRECTCOSTS" } },
  referral_fees: { label: "Referral fees", hint: "The channel's commission on each sale.", section: "costs", suggest: { name: "Selling Fees", type: "DIRECTCOSTS" } },
  fba_fees: { label: "Fulfillment fees", hint: "Picking, packing and shipping done by the channel.", section: "costs", suggest: { name: "Fulfillment Fees", type: "DIRECTCOSTS" } },
  payment_fees: { label: "Payment processing", hint: "Card and payment gateway fees.", section: "costs", suggest: { name: "Payment Processing Fees", type: "DIRECTCOSTS" } },
  storage_fees: { label: "Storage fees", hint: "Warehouse storage the channel charges.", section: "costs", suggest: { name: "Storage Fees", type: "DIRECTCOSTS" } },
  custom_fees: { label: "Custom fees", hint: "Fees you added to orders in consl.", section: "costs", suggest: { name: "Other Selling Costs", type: "DIRECTCOSTS" } },
  advertising: { label: "Advertising", hint: "Ad spend on the channel and its ad platforms.", section: "marketing", suggest: { name: "Advertising", type: "EXPENSE" } },
  other: { label: "Other transactions", hint: "Reimbursements, adjustments and anything else the channel reports.", section: "other", suggest: { name: "Marketplace Adjustments", type: "OTHERINCOME" } },
};
export const LINE_ORDER: LineKey[] = ["sales", "refunds", "cogs", "removals", "referral_fees", "fba_fees", "payment_fees", "storage_fees", "custom_fees", "advertising", "other"];

export type BalanceRow = { key: string; label: string; hint: string; channel?: XeroChannel; suggest: Suggestion };

/** Where a row posts: an account already in Xero, or one consl creates in Xero when saving. */
export type XeroTarget =
  | { kind: "account"; accountId: string; code: string; name: string; type: string }
  | { kind: "new"; name: string; type: string };

export type XeroAccountOption = { accountId: string; code: string; name: string; type: string };

export const lineRowKey = (channel: XeroChannel, line: LineKey) => `line:${channel}:${line}`;

/** Xero's account types in plain words, for the pickers. */
export const XERO_TYPE_LABEL: Record<string, string> = {
  REVENUE: "Revenue",
  SALES: "Sales",
  OTHERINCOME: "Other income",
  DIRECTCOSTS: "Direct costs",
  EXPENSE: "Expense",
  OVERHEADS: "Overhead",
  DEPRECIATN: "Depreciation",
  CURRENT: "Current asset",
  INVENTORY: "Inventory",
  PREPAYMENT: "Prepayment",
  FIXED: "Fixed asset",
  NONCURRENT: "Non-current asset",
  CURRLIAB: "Current liability",
  LIABILITY: "Liability",
  TERMLIAB: "Non-current liability",
  EQUITY: "Equity",
};

/** The target a picker value stands for: "acc:<id>" (an existing account) or "new:<TYPE>:<name>". */
export function targetValue(t: XeroTarget | null | undefined): string {
  if (!t) return "";
  return t.kind === "account" ? `acc:${t.accountId}` : `new:${t.type}:${t.name}`;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** A real calendar day written "YYYY-MM-DD". */
export const isIsoDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && isoDay(new Date(`${s}T00:00:00Z`)) === s;

/** The last day of the month `day` falls in. */
export function monthEnd(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return isoDay(new Date(Date.UTC(y, m, 0)));
}

export type JournalWindow = { from: string; to: string; partial: boolean };

/**
 * The windows consl sends to Xero, one journal per channel each: the start day's month from that
 * day on (a partial first month unless it starts on the 1st), then whole calendar months. Days are
 * the company's calendar days, cut the way the P&L cuts them, so a window's numbers are exactly the
 * P&L for that date range. Only windows whose last day is over (before `today`) are listed.
 */
export function journalWindows(start: string, today: string): JournalWindow[] {
  if (!isIsoDay(start) || !isIsoDay(today)) return [];
  const out: JournalWindow[] = [];
  let from = start;
  while (out.length < 600) {
    const to = monthEnd(from);
    if (to >= today) break;
    out.push({ from, to, partial: from.slice(8) !== "01" });
    from = isoDay(new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 1)));
  }
  return out;
}
