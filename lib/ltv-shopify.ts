/** Shopify facts used by LTV, shared by the history importer and live order updates. */
type Money = { shopMoney: { amount: string; currencyCode?: string } };
export type ShopifyLtvNode = {
  test?: boolean;
  sourceName?: string | null;
  app?: { id?: string; name: string | null } | null;
  channelInformation?: { channelDefinition: { id?: string; channelName: string | null } | null } | null;
  netPaymentSet?: Money | null;
  currentTotalTaxSet?: Money | null;
  totalPriceSet?: Money | null;
};

export const LTV_FACTS_VERSION = 2;
export type LtvFacts = {
  version: typeof LTV_FACTS_VERSION;
  shop: string;
  channelKey: string;
  channelLabel: string;
  test: boolean;
  revenue: number;
  originalTotal: number;
};

// Payments already reflect discounts, shipping and refunds. Subtract the remaining tax once;
// scalar totals also avoid truncation on orders with many line items or refunds.
export const SHOPIFY_LTV_FIELDS = `
  test
  netPaymentSet { shopMoney { amount } }
  currentTotalTaxSet { shopMoney { amount } }
  totalPriceSet { shopMoney { amount } }`;

export function shopifyLtvFacts(order: ShopifyLtvNode, shop: string): LtvFacts | null {
  if (order.test === undefined || !order.netPaymentSet || !order.currentTotalTaxSet || !order.totalPriceSet) return null;
  const amount = (m: Money | null | undefined) => Number(m?.shopMoney.amount ?? 0);
  const originalTotal = amount(order.totalPriceSet);
  const payment = amount(order.netPaymentSet);
  const tax = amount(order.currentTotalTaxSet);
  if (![originalTotal, payment, tax].every(Number.isFinite)) return null;
  // A full manual refund may leave Shopify's tax lines unchanged. It is still zero revenue.
  const revenue = Math.max(0, payment - tax);
  const definition = order.channelInformation?.channelDefinition;
  const label = definition?.channelName || order.app?.name || ({ web: "Online Store", pos: "Point of Sale" }[order.sourceName ?? ""] ?? order.sourceName) || "Unknown channel";
  // An app can create multiple source codes (Seal's first subscription order and renewals).
  // The Shopify app ID groups those orders under one stable selection, even after a rename.
  const channelKey = order.app?.id ? `app:${order.app.id}` : definition?.id ? `channel:${definition.id}` : `source:${order.sourceName || "unknown"}`;
  return { version: LTV_FACTS_VERSION, shop, channelKey, channelLabel: label, test: order.test, revenue: Math.round(revenue * 100) / 100, originalTotal };
}

export function readLtvFacts(value: unknown): LtvFacts | null {
  if (!value || typeof value !== "object") return null;
  const v = value as LtvFacts;
  return v.version === LTV_FACTS_VERSION && typeof v.shop === "string" && typeof v.channelKey === "string" && typeof v.channelLabel === "string" && typeof v.test === "boolean" && [v.revenue, v.originalTotal].every((n) => typeof n === "number" && Number.isFinite(n)) ? v : null;
}

export function channelExcluded(key: string, label: string, overrides: Record<string, boolean>): boolean {
  if (typeof overrides[key] === "boolean") return overrides[key];
  return /faire|tik\s*tok/i.test(`${key} ${label}`);
}

export function readChannelOverrides(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([k, v]) => k.length < 250 && typeof v === "boolean"));
}
