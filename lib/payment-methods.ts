/**
 * Payment methods as the platforms name them — client-safe vocabulary shared by the Orders tab,
 * the fee-rule form and the importers. The KEY is the platform's own gateway key on the order
 * (Shopify's transaction `gateway`; TikTok's payment method name, slugged); the label is what
 * people read. Anything not listed still shows, prettified from its key.
 */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  shopify_payments: "Shopify Payments",
  shopify_installments: "Shop Pay Installments",
  paypal: "PayPal",
  shop_cash: "Shop Cash",
  gift_card: "Gift card",
  store_credit: "Store credit",
  manual: "Manual payment",
  cash: "Cash",
  cash_on_delivery: "Cash on delivery",
  bank_deposit: "Bank deposit",
  money_order: "Money order",
  bogus: "Test gateway",
  tiktok_shop: "TikTok Shop",
  amazon_payments: "Amazon Pay",
  stripe: "Stripe",
  klarna: "Klarna",
  affirm: "Affirm",
  afterpay: "Afterpay",
  authorize_net: "Authorize.net",
  braintree: "Braintree",
  square: "Square",
};

export function paymentMethodLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return PAYMENT_METHOD_LABEL[key] ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A platform's free-text method name as a key: "Shopify Payments" → "shopify_payments". */
export function paymentMethodKey(name: string | null | undefined): string | null {
  const k = (name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return k || null;
}

const WALLET_LABEL: Record<string, string> = { SHOPIFY_PAY: "Shop Pay", APPLE_PAY: "Apple Pay", GOOGLE_PAY: "Google Pay", PAYPAL: "PayPal", AMAZON_PAY: "Amazon Pay" };

/** "SHOPIFY_PAY" → "Shop Pay"; an unknown wallet is prettified. */
export function walletLabel(wallet: string | null | undefined): string | null {
  if (!wallet) return null;
  return WALLET_LABEL[wallet] ?? wallet.replace(/_+/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
