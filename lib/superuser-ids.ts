/**
 * Who may open the internal area — and, from there, any company: the founder's admin account.
 *
 * Identified by Clerk user id, not by email. Emails aren't verified at sign-up on this instance
 * (the founder wanted no email code), so an email allowlist could be claimed by anyone who typed
 * it first; a user id can't be. Set SUPERUSER_CLERK_IDS on the deployment (comma-separated).
 * Plain module: the middleware (proxy.ts) reads it, so no next/headers and no "server-only".
 */
export function superuserIds(): Set<string> {
  return new Set(
    (process.env.SUPERUSER_CLERK_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isSuperuserId(userId: string | null | undefined): boolean {
  return !!userId && superuserIds().has(userId);
}

/** The switcher's pinned entry for the internal area — not a real organization id. */
export const INTERNAL_ORG_ID = "internal";
