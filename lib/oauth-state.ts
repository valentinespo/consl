import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed, time-limited OAuth `state` shared by every provider's connect flow (Amazon, Shopify, …).
 * Carries the org id + a timestamp, HMAC-signed with INTEGRATION_ENC_KEY, so a callback can't be
 * forged or replayed and always knows which tenant it belongs to.
 */

const STATE_TTL_MS = 15 * 60 * 1000; // a consent flow older than 15 min is stale

function hmacKey(): Buffer {
  const b64 = process.env.INTEGRATION_ENC_KEY;
  if (!b64) throw new Error("INTEGRATION_ENC_KEY is not set");
  return Buffer.from(b64, "base64");
}

function sign(payload: string): string {
  return createHmac("sha256", hmacKey()).update(payload).digest("base64url");
}

/** Signed, time-limited state binding this consent flow to one org. */
export function makeState(orgId: string): string {
  const payload = `${orgId}.${Date.now()}.${randomBytes(8).toString("hex")}`;
  return Buffer.from(`${payload}.${sign(payload)}`).toString("base64url");
}

/** Returns the orgId if the state is authentic and fresh; null otherwise. */
export function verifyState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const i = decoded.lastIndexOf(".");
    if (i < 0) return null;
    const payload = decoded.slice(0, i);
    const sig = decoded.slice(i + 1);
    const expected = sign(payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const [orgId, tsStr] = payload.split(".");
    if (!orgId || !tsStr) return null;
    if (Date.now() - Number(tsStr) > STATE_TTL_MS) return null;
    return orgId;
  } catch {
    return null;
  }
}
