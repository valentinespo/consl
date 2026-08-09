"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { recomputeAll } from "@/lib/recompute";
import { saveImage, deleteStored, safeKeySegment } from "@/lib/storage";
import { checkOwned, type OwnedModel } from "@/lib/ownership";
import { requirePermission } from "@/lib/membership";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const OK_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);

type ImageKind = "product" | "material" | "supplier";
const IMAGE_MODEL: Record<ImageKind, OwnedModel> = Object.assign(Object.create(null), {
  product: "product",
  material: "material",
  supplier: "supplier",
});

/** Upload an image for a product, material, or supplier and store its URL. */
export async function uploadEntityImage(formData: FormData) {
  const gate = await requirePermission("catalog", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const kind = String(formData.get("kind")) as ImageKind;
  const id = String(formData.get("id"));
  const file = formData.get("file") as File | null;

  // `kind` and `id` become the storage path, so both are validated before anything is written.
  if (!IMAGE_MODEL[kind]) return { ok: false, error: "Unknown kind" };
  const owned = await checkOwned([[IMAGE_MODEL[kind], id]]);
  if (owned) return owned;
  if (!file || file.size === 0) return { ok: false, error: "No file" };
  if (file.size > MAX_BYTES) return { ok: false, error: "File too large (max 8MB)" };

  const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
  if (!OK_EXT.has(ext)) return { ok: false, error: "Unsupported image type" };

  const key = `${kind}/${safeKeySegment(id)}-${Date.now()}.${ext}`;
  // Type comes from the validated extension — a client-declared text/html would be served as HTML.
  const type = `image/${ext === "jpg" ? "jpeg" : ext}`;
  const url = await saveImage(key, Buffer.from(await file.arrayBuffer()), type);

  if (kind === "product") await prisma.product.update({ where: { id }, data: { imageUrl: url } });
  else if (kind === "material") await prisma.materialType.update({ where: { id }, data: { imageUrl: url } });
  else await prisma.supplier.update({ where: { id }, data: { photoUrl: url } });

  revalidatePath("/", "layout");
  return { ok: true, url };
}

function slugCode(name: string, max = 10): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, max) || "ITEM";
}

/** Create a product (SKU). Returns the created (or existing) product. */
// Words skipped when building an abbreviation from a product name (so "Liver and Kidney Detox
// Tea" → LKD, not LAK).
const CODE_STOPWORDS = new Set(["AND", "THE", "OF", "WITH", "FOR", "A", "AN", "TO", "IN", "ON", "&"]);

/** A 3-letter abbreviation derived from a product name — initials of its significant words, padded
 *  from the first word's letters if there aren't three. Uppercase, letters/digits only. */
function abbrevFromName(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !CODE_STOPWORDS.has(w));
  let base = words.map((w) => w[0]).join("");
  if (base.length < 3) {
    const letters = ((words[0] ?? name.toUpperCase().replace(/[^A-Z0-9]/g, "")) + "XXX").replace(/[^A-Z0-9]/g, "");
    base = (base + letters).slice(0, 3);
  }
  return base.slice(0, 3) || "SKU";
}

/** A unique code (never repeats) for a new product: the 3-letter abbreviation, or that base plus a
 *  numeric suffix (LKD → LKD2 → LKD3…) for variations/collisions. `used` is mutated to reserve it. */
function uniqueProductCode(name: string, used: Set<string>): string {
  const base = abbrevFromName(name);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let n = 2; n <= 9999; n++) {
    const cand = `${base}${n}`.slice(0, 8);
    if (!used.has(cand)) {
      used.add(cand);
      return cand;
    }
  }
  const fallback = `${base}${used.size}`.slice(0, 8);
  used.add(fallback);
  return fallback;
}

/**
 * Catalog bootstrap — create products from the org's live FBA inventory summaries so onboarding
 * isn't a manual wall. Idempotent (SKUs already present, matched by sellerSku or ASIN, are skipped).
 * Each new product gets an auto-generated unique 3-letter abbreviation and, best-effort, Amazon's
 * main product image pulled in as its photo. The real platform SKU/ASIN are stored on the mapping.
 */
export async function importAmazonCatalog() {
  const gate = await requirePermission("catalog", "create");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const conn = await prisma.integration.findFirst({ where: { provider: "amazon", status: "connected" } });
  if (!conn?.refreshTokenEnc) return { ok: false as const, error: "Connect Amazon first (Settings → Integrations)." };

  const { makeClient, getFbaInventory, getCatalogImage } = await import("@/lib/spapi");
  const { decryptSecret } = await import("@/lib/secret-box");
  const client = makeClient({
    refreshToken: decryptSecret(conn.refreshTokenEnc),
    marketplaceId: conn.marketplaceId ?? "ATVPDKIKX0DER",
    region: conn.region ?? "na",
  });
  let rows;
  try {
    rows = await getFbaInventory(client);
  } catch (e) {
    return { ok: false as const, error: `Amazon pull failed: ${(e as Error).message.slice(0, 200)}` };
  }

  const existing = await prisma.product.findMany({ select: { code: true, sellerSku: true, asin: true } });
  const knownSku = new Set(existing.map((p) => p.sellerSku).filter(Boolean) as string[]);
  const knownAsin = new Set(existing.map((p) => p.asin).filter(Boolean) as string[]);
  const usedCodes = new Set(existing.map((p) => p.code));

  let created = 0;
  let images = 0;
  for (const r of rows) {
    if (!r.sellerSku || knownSku.has(r.sellerSku) || (r.asin && knownAsin.has(r.asin))) continue;
    const name = r.name?.trim() || r.sellerSku;
    const code = uniqueProductCode(name, usedCodes);
    knownSku.add(r.sellerSku);
    if (r.asin) knownAsin.add(r.asin);

    // Best-effort main image — never let a failed image block the product.
    let imageUrl: string | null = null;
    if (r.asin) {
      try {
        const src = await getCatalogImage(client, r.asin);
        if (src) {
          const resp = await fetch(src);
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            const ext = (src.split("?")[0].split(".").pop() ?? "jpg").toLowerCase();
            const safeExt = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext) ? ext : "jpg";
            const key = `product/import-${safeKeySegment(r.asin)}-${Date.now()}.${safeExt}`;
            imageUrl = await saveImage(key, buf, `image/${safeExt === "jpg" ? "jpeg" : safeExt}`);
            images++;
          }
        }
      } catch {
        /* image is decoration — carry on without it */
      }
    }

    await prisma.product.create({ data: { code, name, sellerSku: r.sellerSku, asin: r.asin, imageUrl } });
    created++;
  }
  revalidatePath("/", "layout");
  return { ok: true as const, created, images, total: rows.length };
}

export async function createProduct(input: { code: string; name?: string }) {
  const gate = await requirePermission("catalog", "create");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const code = input.code.trim().toUpperCase().replace(/\s+/g, "").slice(0, 8);
  if (!code) return { ok: false as const, error: "Abbreviation required" };
  const name = (input.name ?? "").trim() || code;
  const existing = await prisma.product.findFirst({ where: { code } });
  if (existing) return { ok: true as const, id: existing.id, code: existing.code, name: existing.name, existed: true };
  const p = await prisma.product.create({ data: { code, name } });
  revalidatePath("/", "layout");
  return { ok: true as const, id: p.id, code: p.code, name: p.name };
}

/** Create a raw-material type. New materials get their own purchases table automatically. */
export async function createMaterial(input: {
  name: string;
  unitLabel?: string;
  skuSpecific?: boolean;
}) {
  const gate = await requirePermission("catalog", "create");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Material name required" };
  let code = slugCode(name);
  let n = 1;
  while (await prisma.materialType.findFirst({ where: { code } })) code = `${slugCode(name)}${n++}`;
  const skuSpecific = !!input.skuSpecific;
  const m = await prisma.materialType.create({
    data: {
      code,
      name,
      unitLabel: (input.unitLabel ?? "").trim() || "unit",
      poolKey: skuSpecific ? "FACILITY_SKU" : "FACILITY",
      skuSpecific,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const, id: m.id, code: m.code, name: m.name };
}

/** Edit an existing SKU's code &/or name. A code rename cascades to transaction allocation tags. */
export async function updateProduct(input: { id: string; code: string; name: string; notes?: string }) {
  const gate = await requirePermission("catalog", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const code = input.code.trim().toUpperCase().replace(/\s+/g, "").slice(0, 8);
  const name = input.name.trim();
  if (!code) return { ok: false as const, error: "Abbreviation required" };
  if (!name) return { ok: false as const, error: "Name required" };
  const current = await prisma.product.findUnique({ where: { id: input.id } });
  if (!current) return { ok: false as const, error: "SKU not found" };
  if (code !== current.code) {
    const clash = await prisma.product.findFirst({ where: { code } });
    if (clash) return { ok: false as const, error: `Abbreviation ${code} already exists` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: input.id },
      data: { code, name, ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}) },
    });
    // Transaction allocation lines tag their SKU by code string — keep them pointing at this SKU.
    if (code !== current.code) await tx.transaction.updateMany({ where: { skus: current.code }, data: { skus: code } });
  });
  if (code !== current.code) await recomputeAll();
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Edit a raw material. The `code` is deliberately NOT editable: it's the FIFO pool key and the
 *  label on every stored lot cost snapshot, it never appears in the UI, and it stays unique per
 *  org by DB constraint. It is generated once at creation and left alone from then on. */
export async function updateMaterial(input: {
  id: string;
  name: string;
  unitLabel: string;
  lowStockThreshold: number | null;
  skuSpecific?: boolean;
}) {
  const gate = await requirePermission("catalog", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Name required" };

  const current = await prisma.materialType.findFirst({ where: { id: input.id } });
  if (!current) return { ok: false as const, error: "Material not found" };

  // Whether it's stocked per-SKU is structural — it decides how FIFO pools are keyed. Once the
  // material has any history, switching it would scramble those pools, so it locks.
  let skuSpecific = current.skuSpecific;
  if (input.skuSpecific !== undefined && input.skuSpecific !== current.skuSpecific) {
    const [purchases, lotMaterials, movements] = await Promise.all([
      prisma.purchase.count({ where: { materialTypeId: input.id } }),
      prisma.lotMaterial.count({ where: { materialTypeId: input.id } }),
      prisma.stockMovement.count({ where: { materialTypeId: input.id } }),
    ]);
    if (purchases + lotMaterials + movements > 0) {
      return { ok: false as const, error: "This material is already in use, so per-SKU stocking can no longer be changed." };
    }
    skuSpecific = input.skuSpecific;
  }

  await prisma.materialType.update({
    where: { id: input.id },
    data: {
      name,
      unitLabel: input.unitLabel.trim() || "unit",
      lowStockThreshold: input.lowStockThreshold != null && input.lowStockThreshold > 0 ? input.lowStockThreshold : null,
      skuSpecific,
      poolKey: skuSpecific ? "FACILITY_SKU" : "FACILITY",
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Map a product to each sales channel. Identifiers only — nothing is synced yet. */
export async function updateProductChannels(input: {
  id: string;
  barcode: string;
  asin: string;
  sellerSku: string;
  fnsku: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  shopifySku: string;
  tiktokProductId: string;
  tiktokSku: string;
}) {
  const gate = await requirePermission("catalog", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const clean = (s: string) => {
    const t = s.trim();
    return t === "" ? null : t;
  };
  await prisma.product.update({
    where: { id: input.id },
    data: {
      barcode: clean(input.barcode),
      asin: clean(input.asin),
      sellerSku: clean(input.sellerSku),
      fnsku: clean(input.fnsku),
      shopifyProductId: clean(input.shopifyProductId),
      shopifyVariantId: clean(input.shopifyVariantId),
      shopifySku: clean(input.shopifySku),
      tiktokProductId: clean(input.tiktokProductId),
      tiktokSku: clean(input.tiktokSku),
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Delete a product — refused while anything still references it (checked here, not just in the UI). */
export async function deleteProduct(id: string) {
  const gate = await requirePermission("catalog", "delete");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const product = await prisma.product.findFirst({ where: { id } });
  if (!product) return { ok: false as const, error: "Product not found" };

  // Movements count too: deleting a product nulls `productId` on its stock movements, which
  // re-points a per-SKU write-off at a pool that doesn't exist — resurrecting the written-off stock.
  const [lotLines, purchases, poLines, transactions, movements] = await Promise.all([
    prisma.lotLine.count({ where: { productId: id } }),
    prisma.purchase.count({ where: { productId: id } }),
    prisma.purchaseOrderLine.count({ where: { productId: id } }),
    prisma.transaction.count({ where: { skus: product.code } }),
    prisma.stockMovement.count({ where: { productId: id } }),
  ]);
  if (lotLines + purchases + poLines + transactions + movements > 0) {
    return { ok: false as const, error: "This product is in use and can no longer be deleted." };
  }

  await prisma.product.delete({ where: { id } }); // Amazon snapshots cascade
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Delete a raw material — refused while any purchase, invoice or lot recipe still references it. */
export async function deleteMaterial(id: string) {
  const gate = await requirePermission("catalog", "delete");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const material = await prisma.materialType.findFirst({ where: { id } });
  if (!material) return { ok: false as const, error: "Material not found" };

  // Include movements: deleting a material orphans its stock movements to a blank material code,
  // which produces a phantom pool the engine can never drain.
  const [purchases, invoices, lotMaterials, movements] = await Promise.all([
    prisma.purchase.count({ where: { materialTypeId: id } }),
    prisma.purchaseInvoice.count({ where: { materialTypeId: id } }),
    prisma.lotMaterial.count({ where: { materialTypeId: id } }),
    prisma.stockMovement.count({ where: { materialTypeId: id } }),
  ]);
  if (purchases + invoices + lotMaterials + movements > 0) {
    return { ok: false as const, error: "This raw material is in use and can no longer be deleted." };
  }

  await prisma.materialType.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function removeEntityImage(formData: FormData) {
  const gate = await requirePermission("catalog", "edit");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const kind = String(formData.get("kind")) as ImageKind;
  const id = String(formData.get("id"));
  if (!IMAGE_MODEL[kind]) return;
  if (await checkOwned([[IMAGE_MODEL[kind], id]])) return;

  // Clear the reference and drop the stored object, so the image isn't still fetchable after removal.
  if (kind === "product") {
    const row = await prisma.product.findFirst({ where: { id }, select: { imageUrl: true } });
    await prisma.product.update({ where: { id }, data: { imageUrl: null } });
    await deleteStored(row?.imageUrl);
  } else if (kind === "material") {
    const row = await prisma.materialType.findFirst({ where: { id }, select: { imageUrl: true } });
    await prisma.materialType.update({ where: { id }, data: { imageUrl: null } });
    await deleteStored(row?.imageUrl);
  } else {
    const row = await prisma.supplier.findFirst({ where: { id }, select: { photoUrl: true } });
    await prisma.supplier.update({ where: { id }, data: { photoUrl: null } });
    await deleteStored(row?.photoUrl);
  }
  revalidatePath("/", "layout");
}

// ---------- Channel product mapping (the mapping screen's actions) ----------

/** Re-pull a channel's live catalog and auto-map the no-judgement-needed exact matches. */
export async function refreshChannelListings(channel: "SHOPIFY" | "AMAZON") {
  const gate = await requirePermission("catalog", "create");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const { refreshChannelListingsCore, autoMapExact } = await import("@/lib/channel-catalog");
  try {
    const { seen } = await refreshChannelListingsCore(channel);
    const autoMapped = await autoMapExact(channel);
    revalidatePath("/", "layout");
    return { ok: true as const, seen, autoMapped };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message.slice(0, 200) };
  }
}

export type MappingActionItem =
  | { listingId: string; action: "map"; productId: string }
  | { listingId: string; action: "import" }
  | { listingId: string; action: "ignore" }
  | { listingId: string; action: "restore" }
  | { listingId: string; action: "unmap" };

/**
 * Commit the staged decisions from the mapping screen in one save. Each item is guarded on its
 * own (a bad row reports, the rest still land). Mapping only writes Product identifier columns —
 * costing data is untouched, so no recompute.
 */
export async function applyChannelMappings(channel: "SHOPIFY" | "AMAZON", items: MappingActionItem[]) {
  const gate = await requirePermission("catalog", "create");
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const { mappingData, unmappingData, mappedExternalId, PRODUCT_MATCH_SELECT } = await import("@/lib/channel-catalog");

  const results: Array<{ listingId: string; ok: boolean; error?: string }> = [];
  for (const item of items) {
    try {
      const listing = await prisma.channelListing.findFirst({ where: { id: item.listingId, channel } });
      if (!listing) throw new Error("Listing not found");

      if (item.action === "ignore" || item.action === "restore") {
        await prisma.channelListing.update({ where: { id: listing.id }, data: { ignored: item.action === "ignore" } });
      } else if (item.action === "unmap") {
        const products = await prisma.product.findMany({ select: PRODUCT_MATCH_SELECT });
        const owner = products.find((p) => mappedExternalId(p, channel) === listing.externalId);
        if (owner) await prisma.product.update({ where: { id: owner.id }, data: unmappingData(channel) });
      } else if (item.action === "map") {
        const products = await prisma.product.findMany({ select: PRODUCT_MATCH_SELECT });
        const target = products.find((p) => p.id === item.productId);
        if (!target) throw new Error("Product not found");
        const takenBy = mappedExternalId(target, channel);
        if (takenBy && takenBy !== listing.externalId) throw new Error(`${target.code} is already mapped on this channel`);
        const current = products.find((p) => mappedExternalId(p, channel) === listing.externalId);
        if (current && current.id !== target.id)
          await prisma.product.update({ where: { id: current.id }, data: unmappingData(channel) });
        await prisma.product.update({ where: { id: target.id }, data: mappingData(channel, listing) });
        if (listing.ignored) await prisma.channelListing.update({ where: { id: listing.id }, data: { ignored: false } });
      } else if (item.action === "import") {
        const existing = await prisma.product.findMany({ select: { code: true } });
        const used = new Set(existing.map((p) => p.code));
        const code = uniqueProductCode(listing.title, used);

        // Best-effort listing image → product photo; failure never blocks the import.
        let imageUrl: string | null = null;
        if (listing.imageUrl) {
          try {
            const resp = await fetch(listing.imageUrl);
            if (resp.ok) {
              const buf = Buffer.from(await resp.arrayBuffer());
              const ext = (listing.imageUrl.split("?")[0].split(".").pop() ?? "jpg").toLowerCase();
              const safeExt = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext) ? ext : "jpg";
              const key = `product/import-${safeKeySegment(listing.id)}-${Date.now()}.${safeExt}`;
              imageUrl = await saveImage(key, buf, `image/${safeExt === "jpg" ? "jpeg" : safeExt}`);
            }
          } catch {
            /* image is decoration */
          }
        }

        const { mappingData: md } = await import("@/lib/channel-catalog");
        await prisma.product.create({
          data: { code, name: listing.title, imageUrl, ...md(channel, listing) },
        });
        if (listing.ignored) await prisma.channelListing.update({ where: { id: listing.id }, data: { ignored: false } });
      }
      results.push({ listingId: item.listingId, ok: true });
    } catch (e) {
      results.push({ listingId: item.listingId, ok: false, error: (e as Error).message.slice(0, 160) });
    }
  }

  revalidatePath("/", "layout");
  const failed = results.filter((r) => !r.ok);
  return { ok: true as const, applied: results.length - failed.length, failed };
}
