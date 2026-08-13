/** How long a deleted company is kept, dark and recoverable, before the scheduler purges it for
 *  good. Plain module (no "server-only") so the client delete dialog can show the same number. */
export const DELETE_GRACE_DAYS = 60;

/**
 * StockMovement kinds that create a FIFO layer with an operator-entered cost instead of moving
 * existing stock: onboarding starting balances, found-stock corrections, customer returns.
 * The costing engines treat all of them identically — a layer appearing at its `unitCost`.
 */
export const LAYER_KINDS = ["OPENING", "ADJUST_FOUND", "ADJUST_RETURN"] as const;
export function isLayerKind(kind: string): boolean {
  return (LAYER_KINDS as readonly string[]).includes(kind);
}
