"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { recomputeAll } from "@/lib/recompute";
import { saveImage } from "@/lib/storage";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const OK_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);

/** Upload an image for a product, material, or supplier and store its URL. */
export async function uploadEntityImage(formData: FormData) {
  const kind = String(formData.get("kind")); // "product" | "material" | "supplier"
  const id = String(formData.get("id"));
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "No file" };
  if (file.size > MAX_BYTES) return { ok: false, error: "File too large (max 8MB)" };

  const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
  if (!OK_EXT.has(ext)) return { ok: false, error: "Unsupported image type" };

  const key = `${kind}/${id}-${Date.now()}.${ext}`;
  const url = await saveImage(key, Buffer.from(await file.arrayBuffer()), file.type || `image/${ext}`);

  if (kind === "product") await prisma.product.update({ where: { id }, data: { imageUrl: url } });
  else if (kind === "material") await prisma.materialType.update({ where: { id }, data: { imageUrl: url } });
  else if (kind === "supplier") await prisma.supplier.update({ where: { id }, data: { photoUrl: url } });
  else return { ok: false, error: "Unknown kind" };

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
  const existing = await prisma.product.findUnique({ where: { code } });
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
  while (await prisma.materialType.findUnique({ where: { code } })) code = `${slugCode(name)}${n++}`;
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
export async function updateProduct(input: { id: string; code: string; name: string }) {
  const code = input.code.trim().toUpperCase().replace(/\s+/g, "");
  const name = input.name.trim();
  if (!code) return { ok: false as const, error: "SKU code required" };
  if (!name) return { ok: false as const, error: "Name required" };
  const current = await prisma.product.findUnique({ where: { id: input.id } });
  if (!current) return { ok: false as const, error: "SKU not found" };
  if (code !== current.code) {
    const clash = await prisma.product.findUnique({ where: { code } });
    if (clash) return { ok: false as const, error: `SKU code ${code} already exists` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: input.id }, data: { code, name } });
    // Transaction allocation lines tag their SKU by code string — keep them pointing at this SKU.
    if (code !== current.code) await tx.transaction.updateMany({ where: { skus: current.code }, data: { skus: code } });
  });
  if (code !== current.code) await recomputeAll();
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Edit a raw material's display name, unit label, and default per-unit rate (used for new lots). */
export async function updateMaterial(input: { id: string; name: string; unitLabel: string; defaultPerUnit: number }) {
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Name required" };
  await prisma.materialType.update({
    where: { id: input.id },
    data: {
      name,
      unitLabel: input.unitLabel.trim() || "unit",
      defaultPerUnit: input.defaultPerUnit > 0 ? input.defaultPerUnit : 1,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function removeEntityImage(formData: FormData) {
  const kind = String(formData.get("kind"));
  const id = String(formData.get("id"));
  if (kind === "product") await prisma.product.update({ where: { id }, data: { imageUrl: null } });
  else if (kind === "material") await prisma.materialType.update({ where: { id }, data: { imageUrl: null } });
  else if (kind === "supplier") await prisma.supplier.update({ where: { id }, data: { photoUrl: null } });
  revalidatePath("/", "layout");
}
