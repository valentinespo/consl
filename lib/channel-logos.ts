/**
 * Platform marks per channel — static app assets, keyed by channel tag. Plain module (no
 * "server-only") so client components (the movement form's dropdowns) can show them too;
 * lib/integrations re-exports it for the server-side callers that always used it from there.
 * The marks sit on a white tile: Amazon's are supplied on white, so this keeps them identical
 * in light and dark themes.
 */
export const CHANNEL_LOGO: Record<string, string> = {
  AMAZON_FBA: "/integrations/amazon-fba.png",
  AMAZON_AWD: "/integrations/amazon-awd.png",
  SHOPIFY: "/integrations/shopify.png",
  TIKTOK: "/integrations/tiktok.png",
};

/** Logo for a channel ROOT (the pool key the movement ledger uses). */
export const ROOT_LOGO: Record<string, string> = {
  AMAZON: "/integrations/amazon-fba.png",
  SHOPIFY: "/integrations/shopify.png",
  TIKTOK: "/integrations/tiktok.png",
};
