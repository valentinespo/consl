import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/org";
import { getR2Object } from "@/lib/storage";

// Serves user-uploaded files from the persistent volume (UPLOAD_DIR). These are invoices, BOLs,
// COAs and product photos — tenant data, so a signed-in session (enforced by middleware) is not
// enough on its own: the requested file must also belong to the caller's organization.
const UPLOAD_DIR = process.env.UPLOAD_DIR;

// Historical files were committed under public/uploads and served statically with no auth — a real
// exposure. They've been moved here, out of the statically-served folder; middleware rewrites the
// old /uploads/* URLs to this route so they now pass the same ownership check as everything else.
// Their DB rows still hold "/uploads/..." URLs, so ownership is matched against that form too.
const LEGACY_DIR = path.join(process.cwd(), "legacy-uploads");

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

/**
 * True when something in the caller's organization references this exact URL.
 *
 * Every column that can hold a stored-file URL has to be listed here — a file that nothing claims
 * is treated as not yours and 404s. Keep this in step with the `saveImage` callers:
 * app/documents, app/catalog, app/purchase-orders and app/settings (the company's own branding).
 *
 * The per-row lookups go through the tenant-scoped client, so another org's file simply isn't
 * found. The organization itself is cross-tenant, so its branding is compared against the caller's
 * current company instead.
 */
async function callerOwns(rel: string): Promise<boolean> {
  // A file may be referenced as "/media/<rel>" (current) or "/uploads/<rel>" (legacy rows) — a
  // match on either form, owned by the caller's org, grants access.
  const urls = [`/media/${rel}`, `/uploads/${rel}`];
  const inCol = { in: urls };
  const [org, doc, product, material, supplier, po] = await Promise.all([
    getCurrentOrg().catch(() => null),
    prisma.document.findFirst({ where: { fileUrl: inCol }, select: { id: true } }),
    prisma.product.findFirst({ where: { imageUrl: inCol }, select: { id: true } }),
    prisma.materialType.findFirst({ where: { imageUrl: inCol }, select: { id: true } }),
    prisma.supplier.findFirst({ where: { photoUrl: inCol }, select: { id: true } }),
    prisma.purchaseOrder.findFirst({ where: { pdfUrl: inCol }, select: { id: true } }),
  ]);
  const isOwnBranding = !!org && (urls.includes(org.logoUrl ?? "") || urls.includes(org.iconUrl ?? ""));
  return isOwnBranding || Boolean(doc || product || material || supplier || po);
}

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const rel = parts.join("/");
  if (rel.includes("..") || rel.startsWith("/") || path.normalize(rel) !== rel) {
    return new Response("Bad request", { status: 400 });
  }

  // Same 404 for "doesn't exist" and "not yours" — never confirm another org's files exist.
  let owned = false;
  try {
    owned = await callerOwns(rel);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!owned) return new Response("Not found", { status: 404 });

  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  const serve = (buf: Buffer) =>
    new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        // Private: these are per-tenant documents, so no shared/CDN caching.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });

  // R2 (durable backend) first; then the volume and legacy-uploads. Keeping the disk as a fallback
  // means files not yet migrated to R2 still serve, so switching backends never 404s a file.
  const fromR2 = await getR2Object(rel);
  if (fromR2) return serve(fromR2);

  const dirs = [UPLOAD_DIR, LEGACY_DIR].filter((d): d is string => !!d);
  for (const dir of dirs) {
    try {
      return serve(await readFile(path.join(dir, rel)));
    } catch {
      // try the next directory
    }
  }
  return new Response("Not found", { status: 404 });
}
