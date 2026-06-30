/**
 * Image storage. In production, uploads go to Cloudflare R2 (S3-compatible) because Railway's
 * disk is ephemeral. Locally (no R2 env), it falls back to writing into public/uploads so dev
 * works with zero config.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

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

  // Local dev: write under public/uploads/<key>.
  const full = path.join(process.cwd(), "public", "uploads", key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
  return `/uploads/${key}`;
}
