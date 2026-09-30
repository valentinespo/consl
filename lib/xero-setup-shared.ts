/**
 * The Xero export's vocabulary, shared by the setup screen and the server (plain module, no
 * "server-only"). A company's consl P&L is a set of LINES per channel — the P&L's own groups plus
 * cost of goods — and each line posts to one Xero account. The money those lines move waits in
 * BALANCE rows until the cash moves: a clearing account per channel (payout deposits are coded
 * there), payables for costs paid outside the channel, and inventory (cost of goods leaves it).
 */

export type XeroChannel = "AMAZON" | "SHOPIFY" | "TIKTOK";
export const CHANNEL_NAME: Record<XeroChannel, string> = { AMAZON: "Amazon", SHOPIFY: "Shopify", TIKTOK: "TikTok Shop" };
export const CHANNEL_ORDER: XeroChannel[] = ["AMAZON", "SHOPIFY", "TIKTOK"];

export type LineKey =
  | "sales"
  | "refunds"
  | "taxes"
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

/** A suggestion: the first name is what consl creates; any of them counts as a match in Xero. */
export type Suggestion = { names: string[]; type: string };

export const LINES: Record<LineKey, { label: string; hint: string; section: SectionKey; suggest: Suggestion }> = {
  sales: { label: "Sales", hint: "What customers paid for your products.", section: "revenue", suggest: { names: ["Sales", "Sale of Goods", "Sales of Product Income", "Product Sales", "Sales Revenue", "Revenue"], type: "REVENUE" } },
  refunds: { label: "Refunds", hint: "Money returned to customers.", section: "revenue", suggest: { names: ["Refunds", "Returns and Allowances", "Sales Returns and Allowances", "Sales Returns", "Returns and Refunds"], type: "REVENUE" } },
  taxes: { label: "Taxes", hint: "Sales tax on your orders, as the channel reports it.", section: "revenue", suggest: { names: ["Marketplace Taxes", "Sales Tax Collected"], type: "REVENUE" } },
  cogs: { label: "Cost of goods sold", hint: "The landed cost of every unit sold, from consl.", section: "goods", suggest: { names: ["Cost of Goods Sold", "Cost of Sales", "COGS"], type: "DIRECTCOSTS" } },
  referral_fees: { label: "Referral fees", hint: "The channel's commission on each sale.", section: "costs", suggest: { names: ["Selling Fees", "Marketplace Fees", "Referral Fees", "Amazon Fees"], type: "DIRECTCOSTS" } },
  fba_fees: { label: "Fulfillment fees", hint: "Picking, packing and shipping done by the channel.", section: "costs", suggest: { names: ["Fulfillment Fees", "Fulfilment Fees", "FBA Fees"], type: "DIRECTCOSTS" } },
  payment_fees: { label: "Payment processing", hint: "Card and payment gateway fees.", section: "costs", suggest: { names: ["Payment Processing Fees", "Merchant Fees", "Credit Card Fees", "Merchant Account Fees"], type: "DIRECTCOSTS" } },
  storage_fees: { label: "Storage fees", hint: "Warehouse storage the channel charges.", section: "costs", suggest: { names: ["Storage Fees", "Warehouse Storage", "FBA Storage Fees"], type: "DIRECTCOSTS" } },
  custom_fees: { label: "Custom fees", hint: "Fees you added to orders in consl.", section: "costs", suggest: { names: ["Other Selling Costs"], type: "DIRECTCOSTS" } },
  advertising: { label: "Advertising", hint: "Ad spend on the channel and its ad platforms.", section: "marketing", suggest: { names: ["Advertising", "Advertising & Marketing", "Advertising and Promotion", "Marketing"], type: "EXPENSE" } },
  other: { label: "Other transactions", hint: "Reimbursements, adjustments and anything else the channel reports.", section: "other", suggest: { names: ["Marketplace Adjustments"], type: "OTHERINCOME" } },
};
export const LINE_ORDER: LineKey[] = ["sales", "refunds", "taxes", "cogs", "referral_fees", "fba_fees", "payment_fees", "storage_fees", "custom_fees", "advertising", "other"];

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
