/**
 * A "where to go next" value taken from the URL, reduced to something safe to redirect to: a
 * same-site path only. Absolute URLs (Clerk sends "https://consl.ai/x" as redirect_url) are
 * reduced to their path when they point at this app's own host; anything else is dropped.
 */
export function safeReturnPath(raw: string | undefined | null, ownHost?: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  try {
    const u = new URL(v);
    if (ownHost && u.host === ownHost) return u.pathname + u.search;
    if (/^([a-z0-9-]+\.)*consl\.ai$/i.test(u.host)) return u.pathname + u.search;
  } catch {
    /* not a URL */
  }
  return null;
}
