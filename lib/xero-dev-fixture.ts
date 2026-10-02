import "server-only";

/**
 * LOCAL DEVELOPMENT ONLY (XERO_DEV_FIXTURE=1 under `next dev`): a stand-in Xero organisation with
 * Xero's standard US demo chart of accounts, so the setup screen can be built and clicked through
 * without a live Xero connection. Never read in a production build (the flag is checked together
 * with NODE_ENV, which Next inlines).
 */
export type FixtureAccount = { AccountID: string; Code: string; Name: string; Type: string; Status: string; SystemAccount?: string };

export const devFixture = { orgName: "Demo Company (US)" };

const baseAccounts: FixtureAccount[] = [
  { AccountID: "dev-090", Code: "090", Name: "Business Bank Account", Type: "BANK", Status: "ACTIVE" },
  { AccountID: "dev-200", Code: "200", Name: "Sales", Type: "REVENUE", Status: "ACTIVE" },
  { AccountID: "dev-260", Code: "260", Name: "Other Revenue", Type: "REVENUE", Status: "ACTIVE" },
  { AccountID: "dev-270", Code: "270", Name: "Interest Income", Type: "REVENUE", Status: "ACTIVE" },
  { AccountID: "dev-310", Code: "310", Name: "Cost of Goods Sold", Type: "DIRECTCOSTS", Status: "ACTIVE" },
  { AccountID: "dev-400", Code: "400", Name: "Advertising", Type: "EXPENSE", Status: "ACTIVE" },
  { AccountID: "dev-404", Code: "404", Name: "Bank Fees", Type: "EXPENSE", Status: "ACTIVE" },
  { AccountID: "dev-412", Code: "412", Name: "Consulting & Accounting", Type: "EXPENSE", Status: "ACTIVE" },
  { AccountID: "dev-425", Code: "425", Name: "Freight & Courier", Type: "EXPENSE", Status: "ACTIVE" },
  { AccountID: "dev-429", Code: "429", Name: "General Expenses", Type: "EXPENSE", Status: "ACTIVE" },
  { AccountID: "dev-433", Code: "433", Name: "Insurance", Type: "EXPENSE", Status: "ACTIVE" },
  { AccountID: "dev-453", Code: "453", Name: "Office Expenses", Type: "EXPENSE", Status: "ACTIVE" },
  { AccountID: "dev-469", Code: "469", Name: "Rent", Type: "EXPENSE", Status: "ACTIVE" },
  { AccountID: "dev-485", Code: "485", Name: "Subscriptions", Type: "EXPENSE", Status: "ACTIVE" },
  { AccountID: "dev-489", Code: "489", Name: "Telephone & Internet", Type: "EXPENSE", Status: "ACTIVE" },
  { AccountID: "dev-610", Code: "610", Name: "Accounts Receivable", Type: "CURRENT", Status: "ACTIVE", SystemAccount: "DEBTORS" },
  { AccountID: "dev-620", Code: "620", Name: "Prepayments", Type: "CURRENT", Status: "ACTIVE" },
  { AccountID: "dev-630", Code: "630", Name: "Inventory", Type: "INVENTORY", Status: "ACTIVE" },
  { AccountID: "dev-710", Code: "710", Name: "Office Equipment", Type: "FIXED", Status: "ACTIVE" },
  { AccountID: "dev-800", Code: "800", Name: "Accounts Payable", Type: "CURRLIAB", Status: "ACTIVE", SystemAccount: "CREDITORS" },
  { AccountID: "dev-820", Code: "820", Name: "Sales Tax", Type: "CURRLIAB", Status: "ACTIVE", SystemAccount: "GST" },
  { AccountID: "dev-825", Code: "825", Name: "Employee Tax Payable", Type: "CURRLIAB", Status: "ACTIVE" },
  { AccountID: "dev-900", Code: "900", Name: "Loan", Type: "TERMLIAB", Status: "ACTIVE" },
  { AccountID: "dev-960", Code: "960", Name: "Retained Earnings", Type: "EQUITY", Status: "ACTIVE", SystemAccount: "RETAINEDEARNINGS" },
];

/** Balances the demo chart holds (any day), for the starting-inventory comparison. */
export const devBalances: Record<string, number> = { "dev-630": 41250 };

// Kept on globalThis so accounts "created" by a save survive dev-server module reloads.
const g = globalThis as { __xeroDevAccounts?: FixtureAccount[] };
export const devAccounts: FixtureAccount[] = (g.__xeroDevAccounts ??= [...baseAccounts]);
