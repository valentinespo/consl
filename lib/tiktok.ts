import "server-only";
import { createHmac } from "node:crypto";

/**
 * Minimal TikTok Shop Open API client. One custom app (key/secret in env) serves every tenant;
 * the per-org access token comes from the connection (lib/tiktok-oauth.ts). Version is pinned:
 * TikTok versions each resource path (202309 is the stable generation these calls were verified
 * against), so bump deliberately and re-test rather than floating on "latest".
 *
 * Every request must be signed: sign = HMAC-SHA256-hex(app_secret,
 *   app_secret + path + concat(sorted query "key"+"value" pairs, excluding sign/access_token)
 *   + rawBody + app_secret)
 * with `app_key`, `timestamp` (unix seconds) and `sign` always in the query, and the access token
 * in the `x-tts-access-token` header. There is no separate sandbox host — sandbox tokens use the
 * same gateway.
 */
export const TIKTOK_API_VERSION = "202309";
const TIKTOK_API_HOST = "https://open-api.tiktokglobalshop.com";

export class TikTokError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
  }
}

/** True when the TikTok app is wired up enough to attempt a connect (env + encryption key). */
export function tiktokConfigured(): boolean {
  return Boolean(process.env.TIKTOK_APP_KEY && process.env.TIKTOK_APP_SECRET && process.env.INTEGRATION_ENC_KEY);
}

/** Run one signed TikTok Shop API call. Throws TikTokError (with TikTok's own message) on any
 *  transport failure or non-zero business code. */
export async function tiktokApi<T = unknown>(opts: {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string; // e.g. `/authorization/${TIKTOK_API_VERSION}/shops`
  accessToken: string;
  query?: Record<string, string>;
  body?: unknown;
}): Promise<T> {
  const appSecret = process.env.TIKTOK_APP_SECRET ?? "";
  const query: Record<string, string> = {
    app_key: process.env.TIKTOK_APP_KEY ?? "",
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...(opts.query ?? {}),
  };
  const rawBody = opts.body !== undefined ? JSON.stringify(opts.body) : "";
  const signable = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
    .map((k) => `${k}${query[k]}`)
    .join("");
  const sign = createHmac("sha256", appSecret)
    .update(`${appSecret}${opts.path}${signable}${rawBody}${appSecret}`)
    .digest("hex");

  const params = new URLSearchParams({ ...query, sign });
  const r = await fetch(`${TIKTOK_API_HOST}${opts.path}?${params.toString()}`, {
    method: opts.method,
    headers: { "content-type": "application/json", "x-tts-access-token": opts.accessToken },
    body: opts.body !== undefined ? rawBody : undefined,
  });

  const j = (await r.json().catch(() => null)) as { code?: number; message?: string; data?: T } | null;
  if (!j) throw new TikTokError(`TikTok API ${r.status}: unreadable response`, r.status);
  if (!r.ok || j.code !== 0) {
    throw new TikTokError(`TikTok API: ${j.message || `HTTP ${r.status}`}`.slice(0, 300), r.status, j.code);
  }
  return j.data as T;
}
