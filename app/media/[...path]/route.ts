import { readFile } from "node:fs/promises";
import path from "node:path";

// Serves user-uploaded images from the persistent volume (UPLOAD_DIR). Existing/committed
// images are served statically from /uploads instead; new uploads come through here.
const UPLOAD_DIR = process.env.UPLOAD_DIR;

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
};

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!UPLOAD_DIR) return new Response("Not configured", { status: 404 });
  const { path: parts } = await params;
  const rel = parts.join("/");
  if (rel.includes("..") || rel.startsWith("/")) return new Response("Bad request", { status: 400 });

  try {
    const buf = await readFile(path.join(UPLOAD_DIR, rel));
    const ext = rel.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
