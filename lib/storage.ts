/**
 * Image storage, with three backends, picked by env:
 *  1. Cloudflare R2 (if R2_* set) — S3-compatible object storage.
 *  2. A persistent disk (if UPLOAD_DIR set, e.g. a Railway volume) — files served via /media/*.
 *  3. Local dev fallback — public/uploads, served statically at /uploads/*.
 * Railway's container disk is ephemeral, hence (1)/(2) in production.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const UPLOAD_DIR = process.env.UPLOAD_DIR; // persistent volume mount, e.g. /data/uploads

const R2 = {
  endpoint: process.env.R2_ENDPOINT, // https://<accountid>.r2.cloudflarestorage.com
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  publicUrl: process.env.R2_PUBLIC_URL, // public base URL for the bucket (no trailing slash)
};

export const r2Configured = Boolean(R2.endpoint && R2.accessKeyId && R2.secretAccessKey && R2.bucket && R2.publicUrl);

/** Store an image under `key` (e.g. "product/abc-123.png") and return its public URL. */
export async function saveImage(key: string, body: Buffer, contentType: string): Promise<string> {
  if (r2Configured) {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({
      region: "auto",
      endpoint: R2.endpoint,
      credentials: { accessKeyId: R2.accessKeyId!, secretAccessKey: R2.secretAccessKey! },
    });
    await s3.send(new PutObjectCommand({ Bucket: R2.bucket!, Key: key, Body: body, ContentType: contentType }));
    return `${R2.publicUrl!.replace(/\/+$/, "")}/${key}`;
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
