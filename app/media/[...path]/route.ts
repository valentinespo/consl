import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getCurrentOrg } from "@/lib/org";

// Serves user-uploaded files from the persistent volume (UPLOAD_DIR). These are invoices, BOLs,
// COAs and product photos — tenant data, so a signed-in session (enforced by middleware) is not
// enough on its own: the requested file must also belong to the caller's organization.
const UPLOAD_DIR = process.env.UPLOAD_DIR;

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
async function callerOwns(url: string): Promise<boolean> {
  const [org, doc, product, material, supplier, po] = await Promise.all([
    getCurrentOrg().catch(() => null),
    prisma.document.findFirst({ where: { fileUrl: url }, select: { id: true } }),
    prisma.product.findFirst({ where: { imageUrl: url }, select: { id: true } }),
    prisma.materialType.findFirst({ where: { imageUrl: url }, select: { id: true } }),
    prisma.supplier.findFirst({ where: { photoUrl: url }, select: { id: true } }),
    prisma.purchaseOrder.findFirst({ where: { pdfUrl: url }, select: { id: true } }),
  ]);
  const isOwnBranding = !!org && (org.logoUrl === url || org.iconUrl === url);
  return isOwnBranding || Boolean(doc || product || material || supplier || po);
}

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!UPLOAD_DIR) return new Response("Not configured", { status: 404 });
  const { path: parts } = await params;
  const rel = parts.join("/");
  if (rel.includes("..") || rel.startsWith("/") || path.normalize(rel) !== rel) {
    return new Response("Bad request", { status: 400 });
  }

  // Same 404 for "doesn't exist" and "not yours" — never confirm another org's files exist.
  let owned = false;
  try {
    owned = await callerOwns(`/media/${rel}`);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!owned) return new Response("Not found", { status: 404 });

  try {
    const buf = await readFile(path.join(UPLOAD_DIR, rel));
    const ext = rel.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        // Private: these are per-tenant documents, so no shared/CDN caching.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
