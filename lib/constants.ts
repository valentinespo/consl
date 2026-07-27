/** How long a deleted company is kept, dark and recoverable, before the scheduler purges it for
 *  good. Plain module (no "server-only") so the client delete dialog can show the same number. */
export const DELETE_GRACE_DAYS = 60;
