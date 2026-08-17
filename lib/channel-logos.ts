/**
 * Platform marks per channel — static app assets, keyed by channel tag. Plain module (no
 * "server-only") so client components (the movement form's dropdowns) can show them too;
 * lib/integrations re-exports it for the server-side callers that always used it from there.
 * The marks sit on a white tile: several are supplied on white, so this keeps them identical
 * in light and dark themes.
 *
 * Amazon has TWO marks on purpose: the FBA/AWD tiles name a specific Amazon warehouse programme
 * and keep their own badges, while `amazon.png` (the smile) stands for Amazon as a whole channel —
 * order rows, channel filters, mapping tabs, the connect tiles.
 */
export const CHANNEL_LOGO: Record<string, string> = {
  AMAZON_FBA: "/integrations/amazon-fba.png",
  AMAZON_AWD: "/integrations/amazon-awd.png",
  SHOPIFY: "/integrations/shopify.png",
  TIKTOK: "/integrations/tiktok.png",
};

/** Logo for a channel ROOT (the pool key the movement ledger uses) — the channel in its entirety. */
export const ROOT_LOGO: Record<string, string> = {
  AMAZON: "/integrations/amazon.png",
  SHOPIFY: "/integrations/shopify.png",
  TIKTOK: "/integrations/tiktok.png",
};

/** Same marks keyed by the integration provider id, for connect tiles (settings + onboarding). */
export const PROVIDER_LOGO: Record<string, string> = {
  amazon: "/integrations/amazon.png",
  shopify: "/integrations/shopify.png",
  tiktok: "/integrations/tiktok.png",
};
