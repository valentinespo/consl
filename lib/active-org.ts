import "server-only";
import { cookies } from "next/headers";

/**
 * Which of your companies you're currently working in.
 *
 * A user can belong to several. Membership says which ones they *may* open; this cookie says
 * which one they have open right now. It is only ever trusted after checking the membership
 * still exists, so a stale or hand-edited cookie can't reach a company you were removed from.
 */
export const ACTIVE_ORG_COOKIE = "so_active_org";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** The org id the browser last selected, if any. Not yet validated — always check membership. */
export async function readActiveOrgCookie(): Promise<string | null> {
  try {
    return (await cookies()).get(ACTIVE_ORG_COOKIE)?.value ?? null;
  } catch {
    return null; // no request context (background job / script)
  }
}

/** Remember the selected company. Only callable from a server action or route handler. */
export async function setActiveOrgCookie(orgId: string): Promise<void> {
  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR,
    secure: process.env.NODE_ENV === "production",
  });
}
