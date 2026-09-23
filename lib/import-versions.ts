/**
 * Importer generations. Bump a number whenever an importer's output changes shape or coverage
 * (a new row kind, a wider marketplace filter, a corrected amount): the scheduler then re-reads
 * that source's whole history for every company whose ledger carries an older number, and stamps
 * the new one when it is through. No company's books can silently stay on an old importer.
 *
 *  amazonFinance 3 — region-wide Finances v2024 walk: sister marketplaces (CAD/MXN with FX) and
 *                    MCF shipment fees ("Non-Amazon" marketplace) included.
 *  shopifyFinance 3 — everything the customer is charged: shipping after discount codes, tips,
 *                    duties and additional fees as pass-throughs, tax-inclusive prices unpacked.
 *  shopifyOrders  2 — the payment method (gateway + wallet/card) captured on every order; PayPal
 *                    Wallet inside Shopify Payments named as such.
 *  tiktokOrders   1 — first API generation: a company whose TikTok orders were loaded from a
 *                    Seller Center export (before the shop could authorize) gets one full re-read
 *                    from the API once connected, so every order carries TikTok's own version.
 *  tiktokFinance  1 — first API generation of the settlement ledger (statements, per-order SKU
 *                    split, unsettled money).
 *  tiktokFinance  2 — every SKU split booked under the seller SKU (the order is fetched first
 *                    when consl doesn't hold it; an id no order explains is booked without a
 *                    SKU). Generation 1 could book a split under TikTok's bare SKU id when the
 *                    money read ran before the order read, and the P&L left that money out.
 *  shopifyCustomers 1 — the customer id on every order (what the LTV view groups by). Only a
 *                    connection that may read customers can fill it, so this one is stamped only
 *                    after a full read made WITH that permission: a store that gains it later (a
 *                    reconnect, an approved app update) is re-read then, by itself.
 *  amazonAdsSpend 1 — daily spend per ad type in the ad profile's own currency, with the covered
 *                    day ranges recorded per ad type. A re-read can only reach as far back as
 *                    Amazon still keeps daily data; days already on record stay.
 *  amazonAdsInvoices 1 — Amazon Ads' invoice feed: every invoice with its period, payment record
 *                    and split by ad program. A re-read lists the whole history again.
 */
export const IMPORTER_VERSIONS = { amazonFinance: 3, shopifyFinance: 3, shopifyOrders: 2, shopifyCustomers: 1, tiktokOrders: 1, tiktokFinance: 2, amazonAdsSpend: 1, amazonAdsInvoices: 1 } as const;
export type ImporterKey = keyof typeof IMPORTER_VERSIONS;

/** The generation a company's ledger was written with (0 = before generations were tracked). */
export function importerVersion(stored: unknown, key: ImporterKey): number {
  const v = (stored as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === "number" ? v : 0;
}

/** The stored map with one key moved to the current generation. */
export function stampImporterVersion(stored: unknown, key: ImporterKey): Record<string, number> {
  const base = (stored && typeof stored === "object" ? (stored as Record<string, number>) : {}) as Record<string, number>;
  return { ...base, [key]: IMPORTER_VERSIONS[key] };
}
