/**
 * Importer generations. Bump a number whenever an importer's output changes shape or coverage
 * (a new row kind, a wider marketplace filter, a corrected amount): the scheduler then re-reads
 * that source's whole history for every company whose ledger carries an older number, and stamps
 * the new one when it is through. No company's books can silently stay on an old importer.
 *
 *  amazonFinance 3 — region-wide Finances v2024 walk: sister marketplaces (CAD/MXN with FX) and
 *                    MCF shipment fees ("Non-Amazon" marketplace) included.
 *  shopifyFinance 2 — line revenue net of order-level discounts; fees from the Payments ledger.
 *  shopifyOrders  1 — the payment method (gateway + wallet/card) captured on every order.
 */
export const IMPORTER_VERSIONS = { amazonFinance: 3, shopifyFinance: 2, shopifyOrders: 1 } as const;
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
