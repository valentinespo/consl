import "server-only";
import { auth } from "@clerk/nextjs/server";

/**
 * The signed-in Clerk user id, or null when nobody is.
 *
 * Clerk's `auth()` throws if its middleware didn't run on the request. That is exactly the case in
 * local development, where the middleware is deliberately bypassed (ALLOW_DEV_AUTH_BYPASS) so the
 * app can be opened without signing in. Treat that as "nobody is signed in" rather than letting it
 * crash the page — the dev organization comes from getCurrentOrgId instead.
 */
export async function currentUserId(): Promise<string | null> {
  try {
    return (await auth()).userId ?? null;
  } catch {
    return null;
  }
}

/** True only when the local-dev auth bypass is deliberately switched on. Never true on a deploy,
 *  where NODE_ENV is "production" and the flag is not set. */
export const devAuthBypass =
  process.env.NODE_ENV === "development" && process.env.ALLOW_DEV_AUTH_BYPASS === "1";
