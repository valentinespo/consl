/**
 * The Xero export's vocabulary, shared by the setup screen and the server (plain module, no
 * "server-only"). A company's consl P&L is a set of LINES per channel (the P&L's grouped lines, plus
 * cost of goods). Every platform line is LOCKED to consl's account for its P&L section ("consl -
 * Sales", "consl - Fulfillment Fees"…); the owner picks which Xero account each of those is. Lines
 * the company added itself in consl (custom fees and credits) stay out of Xero until placed in an
 * account, with a balance account picked for them. The money the lines move waits in BALANCE
 * accounts until the cash moves: a receivable per channel (what the channel holds for you; payout
 * deposits are coded there), sales tax payable (tax owed: the state's money, never revenue),
 * payables for what's paid by card, and inventory (cost of goods leaves it). Which one a line uses
 * follows who holds or charged its money (balancesOf).
 */

import type { PnlSource } from "@/lib/pnl-shared";

export type XeroChannel = "AMAZON" | "SHOPIFY" | "TIKTOK";
export const CHANNEL_NAME: Record<XeroChannel, string> = { AMAZON: "Amazon", SHOPIFY: "Shopify", TIKTOK: "TikTok Shop" };
export const CHANNEL_ORDER: XeroChannel[] = ["AMAZON", "SHOPIFY", "TIKTOK"];

export type LineKey =
  | "sales"
  | "refunds"
  | "cogs"
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
  cogs: { label: "Cost of goods sold", hint: "The landed cost of every unit sold, removed or lost, from consl.", section: "goods", suggest: { name: "Cost of Goods Sold", type: "DIRECTCOSTS" } },
  referral_fees: { label: "Referral fees", hint: "The channel's commission on each sale.", section: "costs", suggest: { name: "Selling Fees", type: "DIRECTCOSTS" } },
  fba_fees: { label: "Fulfillment fees", hint: "Picking, packing and shipping by the channel, plus getting stock in, AWD handling and removals.", section: "costs", suggest: { name: "Fulfillment Fees", type: "DIRECTCOSTS" } },
  payment_fees: { label: "Payment processing", hint: "Card and payment gateway fees.", section: "costs", suggest: { name: "Payment Processing Fees", type: "DIRECTCOSTS" } },
  storage_fees: { label: "Storage fees", hint: "Warehouse storage the channel charges (FBA and AWD).", section: "costs", suggest: { name: "Storage Fees", type: "DIRECTCOSTS" } },
  custom_fees: { label: "Custom fees", hint: "Fees you added to orders in consl.", section: "costs", suggest: { name: "Other Selling Costs", type: "DIRECTCOSTS" } },
  advertising: { label: "Advertising", hint: "Ad spend on the channel and its ad platforms.", section: "marketing", suggest: { name: "Advertising", type: "EXPENSE" } },
  other: { label: "Other transactions", hint: "Reimbursements, adjustments and anything else the channel reports.", section: "other", suggest: { name: "Marketplace Adjustments", type: "OTHERINCOME" } },
};
export const LINE_ORDER: LineKey[] = ["sales", "refunds", "cogs", "referral_fees", "fba_fees", "payment_fees", "storage_fees", "custom_fees", "advertising", "other"];

export type BalanceRow = { key: string; label: string; hint: string; channel?: XeroChannel; suggest: Suggestion };

/** Where a row posts: an account already in Xero, or one consl creates in Xero when saving. */
export type XeroTarget =
  | { kind: "account"; accountId: string; code: string; name: string; type: string }
  | { kind: "new"; name: string; type: string };

export type XeroAccountOption = { accountId: string; code: string; name: string; type: string };


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
export const isIsoDay = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && isoDay(d) === s;
};

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

/** One line of the company's consl P&L as the setup shows it, with its all-time amount. */
export type SetupLine = {
  /** "<CHANNEL>|<group>|<line>" */
  id: string;
  channel: XeroChannel;
  /** The P&L section ("cogs" for cost of goods, "taxes" for the tax lines). */
  group: string;
  /** The P&L's grouped line name. */
  line: string;
  amount: number;
  sources: PnlSource[];
  /** Added in consl (custom fees and credits): sent to Xero only once placed. Each keeps its own
   *  name (the fee's, as on the P&L) and is placed on its own. */
  custom: boolean;
  /** A custom line that adds money (a credit) rather than costing it. */
  credit?: boolean;
};

export const setupLineId = (channel: string, group: string, line: string) => `${channel}|${group}|${line}`;

/** A custom line placed in Xero: its P&L account and its balance account (setup keys). */
export type CustomChoice = { account: string; balance: string };

/** How Xero's Inventory starts on the start date: moved to consl's stock value (the difference an
 *  inventory adjustment in that month's P&L), or left as Xero has it. */
export type InventoryOpening = "match" | "keep";

/** The whole setup: what Save keeps as a draft and Publish sends to Xero. */
export type XeroSetupState = {
  targets: Record<string, XeroTarget>;
  customLines: Record<string, CustomChoice>;
  tagChannels: boolean;
  startDate: string;
  inventoryOpening?: InventoryOpening;
};

/** The P&L account the starting-inventory difference posts to when Xero is matched to consl. */
export const INVENTORY_ADJUSTMENT_KEY = "inventory_adjustment";
export const INVENTORY_ADJUSTMENT_SUGGEST: Suggestion = { name: "Inventory Adjustments", type: "DIRECTCOSTS" };

/** The two starting balances for the start date, both at the end of the day before it. */
export type StartingInventory = {
  asOf: string;
  /** That day isn't over yet: both numbers are read once it is. */
  pending: boolean;
  /** consl's stock value that day, from its daily stock record (the dashboard's inventory value);
   *  null when consl has none for that day. */
  consl: { total: number; raw: number; inProduction: number; finished: number } | null;
  /** The first day consl has a stock value for. */
  firstDay: string | null;
  /** Xero's balance in the inventory account that day (0 for an account consl will create). With a
   *  new account, `others` are the company's own inventory accounts that hold stock that day: kept
   *  beside a new one, that stock would be counted twice. */
  xero: { balance: number | null; newAccount: boolean; error?: string; others?: (XeroAccountOption & { balance: number })[] };
};

/** The calendar day before `day` ("YYYY-MM-DD"). */
export function dayBefore(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return isoDay(new Date(Date.UTC(y, m - 1, d - 1)));
}

/** The consl P&L account a platform line is locked to: its section's (a section consl doesn't know
 *  yet: Other). Taxes post to none: they're the state's money, on the balance sheet only. */
export const lockedAccountOf = (l: SetupLine): LineKey | null =>
  l.group === "taxes" ? null : (LINE_ORDER as string[]).includes(l.group) ? (l.group as LineKey) : "other";

/** Accounts the owner adds: P&L ones are "acct:<id>", balance ones "bal:<id>". */
export const isAddedAccount = (key: string) => key.startsWith("acct:");
export const isAddedBalance = (key: string) => key.startsWith("bal:");

export type AccountClass = "income" | "cost" | "asset" | "liability";
export const CLASS_OF_TYPE: Record<string, AccountClass> = {
  REVENUE: "income",
  SALES: "income",
  OTHERINCOME: "income",
  DIRECTCOSTS: "cost",
  EXPENSE: "cost",
  OVERHEADS: "cost",
  DEPRECIATN: "cost",
  CURRENT: "asset",
  INVENTORY: "asset",
  PREPAYMENT: "asset",
  NONCURRENT: "asset",
  FIXED: "asset",
  CURRLIAB: "liability",
  LIABILITY: "liability",
  TERMLIAB: "liability",
};
/** A custom line takes an income account (a credit under Sales) or a cost account (a fee, or a credit against fees). */
export const customClass = (l: SetupLine): AccountClass => (l.group === "sales" ? "income" : "cost");

/** The kinds of account the owner can add, and the Xero type each becomes. */
export const NEW_PL_TYPES = [
  { type: "DIRECTCOSTS", label: "Direct cost" },
  { type: "EXPENSE", label: "Expense" },
  { type: "REVENUE", label: "Income" },
  { type: "OTHERINCOME", label: "Other income" },
] as const;
export const NEW_BALANCE_TYPES = [
  { type: "CURRLIAB", label: "Current liability (money you owe)" },
  { type: "CURRENT", label: "Current asset (money owed to you)" },
] as const;

/**
 * Where a line's money waits until the cash moves, by who holds or charged it (its sources): what
 * Amazon charges sits on the Amazon receivable even when the P&L shows it on another channel (MCF
 * fees on a Shopify or TikTok sale), Meta's spend on Meta Ads payable, Amazon's ad invoices on
 * Amazon Ads payable when paid by card or the Amazon receivable when paid from the balance, cost of
 * goods on Inventory, and tax owed on Sales tax payable (plus the receivable that holds it until the
 * payout). Tax a channel collected and paid over itself nets out inside its receivable. A custom
 * line goes where its owner placed it.
 */
export function balancesOf(l: SetupLine, custom?: CustomChoice): { key: string; note?: string }[] {
  if (l.custom) return custom ? [{ key: custom.balance }] : [];
  if (l.group === "cogs") return [{ key: "inventory" }];
  if (l.group === "taxes") return l.line === "Tax owed" ? [{ key: `receivable:${l.channel}` }, { key: "sales_tax" }] : [];
  const out: { key: string; note?: string }[] = [];
  for (const src of l.sources) {
    if (src === "AMAZON" || src === "SHOPIFY" || src === "TIKTOK") out.push({ key: `receivable:${src}` });
    else if (src === "META") out.push({ key: "payable:META_ADS" });
    else if (src === "AMAZON_ADS") {
      out.push({ key: "payable:AMAZON_ADS", note: "ad invoices paid by card" });
      out.push({ key: "receivable:AMAZON", note: "ad invoices paid from your Amazon balance" });
    }
  }
  if (!out.length) out.push({ key: `receivable:${l.channel}` });
  return out.filter((b, i) => out.findIndex((x) => x.key === b.key && x.note === b.note) === i);
}

/** PayPal's standard US fee for checkout payments (consl's default rule for regular-PayPal orders). */
export const PAYPAL_STANDARD_FEE = { percent: 3.49, fixed: 0.49 };
