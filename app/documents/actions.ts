"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { saveImage } from "@/lib/storage";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — PDFs (BOLs/COAs) can be large
const OK_EXT = new Set(["pdf", "png", "jpg", "jpeg", "webp", "gif", "avif"]);

type Fail = { ok: false; error: string };

function validate(file: File | null): Fail | { ok: true; ext: string } {
  if (!file || file.size === 0) return { ok: false, error: "No file" };
  if (file.size > MAX_BYTES) return { ok: false, error: "File too large (max 25MB)" };
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!OK_EXT.has(ext)) return { ok: false, error: "Only PDF or image files" };
  return { ok: true, ext };
}

async function store(prefix: string, id: string, file: File, ext: string): Promise<string> {
  const key = `${prefix}/${id}-${Date.now()}.${ext}`;
  const type = file.type || (ext === "pdf" ? "application/pdf" : `image/${ext}`);
  return saveImage(key, Buffer.from(await file.arrayBuffer()), type);
}

/** Add a labeled document (COA/BOL/…) to a lot. Lots can hold many. */
export async function uploadLotDocument(formData: FormData) {
  const lotId = String(formData.get("lotId"));
  const label = String(formData.get("label") ?? "").trim() || "Document";
  const file = formData.get("file") as File | null;
  const v = validate(file);
  if (!v.ok) return v;
  const url = await store("lot-docs", lotId, file!, v.ext);
  const max = await prisma.lotDocument.aggregate({ where: { lotId }, _max: { seq: true } });
  await prisma.lotDocument.create({
    data: { lotId, label, fileUrl: url, fileName: file!.name, seq: (max._max.seq ?? -1) + 1 },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function deleteLotDocument(id: string) {
  await prisma.lotDocument.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Attach / replace the single invoice document on a transaction or purchase invoice. */
export async function setInvoiceDocument(formData: FormData) {
  const kind = String(formData.get("kind")); // "transaction" | "purchase"
  const id = String(formData.get("id"));
  const file = formData.get("file") as File | null;
  const v = validate(file);
  if (!v.ok) return v;
  const url = await store(kind === "purchase" ? "pur-inv" : "txn-inv", id, file!, v.ext);
  if (kind === "purchase") await prisma.purchaseInvoice.update({ where: { id }, data: { documentUrl: url } });
  else await prisma.transactionInvoice.update({ where: { id }, data: { documentUrl: url } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function removeInvoiceDocument(formData: FormData) {
  const kind = String(formData.get("kind"));
  const id = String(formData.get("id"));
  if (kind === "purchase") await prisma.purchaseInvoice.update({ where: { id }, data: { documentUrl: null } });
  else await prisma.transactionInvoice.update({ where: { id }, data: { documentUrl: null } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
