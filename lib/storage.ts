/**
 * Image storage, with three backends, picked by env:
 *  1. Cloudflare R2 (if R2_* set) — S3-compatible object storage.
 *  2. A persistent disk (if UPLOAD_DIR set, e.g. a Railway volume) — files served via /media/*.
 *  3. Local dev fallback — public/uploads, served statically at /uploads/*.
 * Railway's container disk is ephemeral, hence (1)/(2) in production.
 */
import "server-only";
import { writeFile, mkdir, unlink, readFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = process.env.UPLOAD_DIR; // persistent volume mount, e.g. /data/uploads

const R2 = {
  endpoint: process.env.R2_ENDPOINT, // https://<accountid>.r2.cloudflarestorage.com
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
};

// R2 is a private bucket read/written server-side; files are still served through the authenticated
// /media route (never a public URL), so no public-URL env var is needed.
export const r2Configured = Boolean(R2.endpoint && R2.accessKeyId && R2.secretAccessKey && R2.bucket);

/** One S3 client for R2, lazily built. */
async function r2Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: "auto",
    endpoint: R2.endpoint,
    credentials: { accessKeyId: R2.accessKeyId!, secretAccessKey: R2.secretAccessKey! },
  });
}

/** Reduce a caller-supplied id to something that cannot escape its folder or start a new path. */
export function safeKeySegment(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, "").replace(/^[.-]+/, "");
  return cleaned.slice(0, 128) || "item";
}

// A key is exactly "<folder>/<name>.<ext>" — one level, no traversal, no absolute paths.
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,31}\/[A-Za-z0-9][A-Za-z0-9._-]{0,190}\.[a-z0-9]{1,8}$/;

/** Reject anything that isn't a plain one-level key before it reaches a filesystem or bucket. */
function assertSafeKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes("..") || path.normalize(key) !== key) {
    throw new Error("Refusing to store a file under an unsafe key.");
  }
}

/** Store an image under `key` (e.g. "product/abc-123.png") and return its public URL. */
export async function saveImage(key: string, body: Buffer, contentType: string): Promise<string> {
  assertSafeKey(key);
  if (r2Configured) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = await r2Client();
    await s3.send(new PutObjectCommand({ Bucket: R2.bucket!, Key: key, Body: body, ContentType: contentType }));
    // Served through the authenticated /media route (which reads R2), NOT a public bucket URL —
    // the stored URL form is identical to the volume backend, so the DB never needs to know which
    // backend holds the bytes.
    return `/media/${key}`;
  }

  if (UPLOAD_DIR) {
    // Persistent volume (production). Served back through the /media route handler.
    const full = path.join(UPLOAD_DIR, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
    return `/media/${key}`;
  }

  // Local dev: write under public/uploads/<key>, served statically at /uploads/*.
  const full = path.join(process.cwd(), "public", "uploads", key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
  return `/uploads/${key}`;
}

/** Recover the storage key from a URL produced by `saveImage`. Null when it isn't one of ours. */
export function keyFromUrl(url: string): string | null {
  let key: string | null = null;
  if (url.startsWith("/media/")) key = url.slice("/media/".length);
  else if (url.startsWith("/uploads/")) key = url.slice("/uploads/".length);
  if (!key) return null;
  try {
    key = decodeURIComponent(key);
  } catch {
    return null;
  }
  return KEY_RE.test(key) && path.normalize(key) === key ? key : null;
}

/** Read a stored object back as bytes. Used for server-side rendering (e.g. a logo in a PDF),
 *  where a URL is no use. Returns null when the file isn't ours or can't be read. */
export async function readStored(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  const key = keyFromUrl(url);
  if (!key) {
    // Not an uploaded file — but it may be a bundled public asset (e.g. an org seeded with
    // logoUrl "/brand/logo.png"). The browser can render those, so documents must too:
    // resolve inside /public only, with the normalized path checked against escapes.
    if (url.startsWith("/") && !url.startsWith("//")) {
      const pub = path.join(process.cwd(), "public");
      const full = path.normalize(path.join(pub, url.split("?")[0]));
      if (full.startsWith(pub + path.sep)) {
        try {
          return await readFile(full);
        } catch {
          return null;
        }
      }
    }
    return null;
  }
  // R2 first (durable backend), then the local disk — during/after a migration a file may live in
  // either, so a miss in R2 falls back to the volume rather than failing.
  const fromR2 = await getR2Object(key);
  if (fromR2) return fromR2;
  try {
    const root = UPLOAD_DIR ?? path.join(process.cwd(), "public", "uploads");
    return await readFile(path.join(root, key));
  } catch {
    return null;
  }
}

/** Fetch an object's bytes from R2 by storage key. Null when R2 isn't configured or the key is
 *  absent. Used by the /media route and readStored so the DB URL never encodes the backend. */
export async function getR2Object(key: string): Promise<Buffer | null> {
  if (!r2Configured || !KEY_RE.test(key) || path.normalize(key) !== key) return null;
  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = await r2Client();
    const res = await s3.send(new GetObjectCommand({ Bucket: R2.bucket!, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}

/** Remove a stored object. Deleting the DB row alone leaves the file fetchable at its old URL. */
export async function deleteStored(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const key = keyFromUrl(url);
  if (!key) return;
  try {
    if (r2Configured) {
      const { S3Client, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const s3 = new S3Client({
        region: "auto",
        endpoint: R2.endpoint,
        credentials: { accessKeyId: R2.accessKeyId!, secretAccessKey: R2.secretAccessKey! },
      });
      await s3.send(new DeleteObjectCommand({ Bucket: R2.bucket!, Key: key }));
      return;
    }
    const root = UPLOAD_DIR ?? path.join(process.cwd(), "public", "uploads");
    await unlink(path.join(root, key));
  } catch {
    // Best effort: a missing or already-removed object must not fail the user's delete.
  }
}
