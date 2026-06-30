/**
 * Shared-password gate. The session cookie holds a SHA-256 of APP_PASSWORD, so it can be
 * verified statelessly in middleware (no session store). Changing the password invalidates
 * all existing cookies. When APP_PASSWORD is unset (e.g. local dev) the gate is disabled.
 */
export const SESSION_COOKIE = "herbl_session";

export async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
