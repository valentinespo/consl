"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { recomputeAll } from "@/lib/recompute";
import { saveImage, deleteStored, safeKeySegment } from "@/lib/storage";
import { checkOwned, type OwnedModel } from "@/lib/ownership";

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
export async function createProduct(input: { code: string; name?: string }) {
  const code = input.code.trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return { ok: false as const, error: "SKU code required" };
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
  defaultPerUnit?: number;
  skuSpecific?: boolean;
}) {
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
      defaultPerUnit: input.defaultPerUnit && input.defaultPerUnit > 0 ? input.defaultPerUnit : 1,
      poolKey: skuSpecific ? "FACILITY_SKU" : "FACILITY",
      skuSpecific,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const, id: m.id, code: m.code, name: m.name };
}

/** Edit an existing SKU's code &/or name. A code rename cascades to transaction allocation tags. */
export async function updateProduct(input: { id: string; code: string; name: string; notes?: string }) {
  const code = input.code.trim().toUpperCase().replace(/\s+/g, "");
  const name = input.name.trim();
  if (!code) return { ok: false as const, error: "SKU code required" };
  if (!name) return { ok: false as const, error: "Name required" };
  const current = await prisma.product.findUnique({ where: { id: input.id } });
  if (!current) return { ok: false as const, error: "SKU not found" };
  if (code !== current.code) {
    const clash = await prisma.product.findFirst({ where: { code } });
    if (clash) return { ok: false as const, error: `SKU code ${code} already exists` };
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

/** Edit a raw material. The code is editable too — costs are keyed by material id, not code,
 *  so a rename is safe once the engine recomputes. */
export async function updateMaterial(input: {
  id: string;
  code?: string;
  name: string;
  unitLabel: string;
  defaultPerUnit: number;
  lowStockThreshold: number | null;
  skuSpecific?: boolean;
}) {
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Name required" };

  const current = await prisma.materialType.findFirst({ where: { id: input.id } });
  if (!current) return { ok: false as const, error: "Material not found" };

  const code = (input.code ?? current.code).trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return { ok: false as const, error: "Code required" };
  if (code !== current.code) {
    const clash = await prisma.materialType.findFirst({ where: { code } });
    if (clash) return { ok: false as const, error: `Code ${code} already exists` };
  }

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
      code,
      name,
      unitLabel: input.unitLabel.trim() || "unit",
      defaultPerUnit: input.defaultPerUnit > 0 ? input.defaultPerUnit : 1,
      lowStockThreshold: input.lowStockThreshold != null && input.lowStockThreshold > 0 ? input.lowStockThreshold : null,
      skuSpecific,
      poolKey: skuSpecific ? "FACILITY_SKU" : "FACILITY",
    },
  });
  if (code !== current.code) await recomputeAll(); // cost snapshots are labelled by code
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
