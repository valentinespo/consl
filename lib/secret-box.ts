import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated symmetric encryption for secrets we must store but never expose — currently the
 * per-tenant OAuth refresh tokens on `Integration`. AES-256-GCM with a random IV per value; the
 * output is `v1:<iv>:<tag>:<ciphertext>` (all base64). GCM's auth tag makes tampering detectable.
 *
 * The key is `INTEGRATION_ENC_KEY` — 32 bytes, base64-encoded, in the environment (Railway). Losing
 * or rotating it makes existing stored tokens undecryptable (sellers just reconnect), so treat it
 * like any other production secret. Never log plaintext or the key.
 */
function key(): Buffer {
  const b64 = process.env.INTEGRATION_ENC_KEY;
  if (!b64) throw new Error("INTEGRATION_ENC_KEY is not set");
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("INTEGRATION_ENC_KEY must be 32 bytes (base64)");
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(blob: string): string {
  const [v, ivB64, tagB64, ctB64] = blob.split(":");
  if (v !== "v1" || !ivB64 || !tagB64 || !ctB64) throw new Error("Malformed secret blob");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** True when the encryption key is configured — lets the UI show "connections unavailable" cleanly
 *  instead of throwing, before the env var is set. */
export function secretBoxReady(): boolean {
  try {
    return Buffer.from(process.env.INTEGRATION_ENC_KEY ?? "", "base64").length === 32;
  } catch {
    return false;
  }
}
