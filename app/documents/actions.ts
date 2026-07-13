"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { saveImage } from "@/lib/storage";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — PDFs (BOLs/COAs/invoices) can be large
const OK_EXT = new Set(["pdf", "png", "jpg", "jpeg", "webp", "gif", "avif"]);

export type DocParent = "lot" | "transaction" | "purchase";
const FIELD: Record<DocParent, "lotId" | "transactionInvoiceId" | "purchaseInvoiceId"> = {
  lot: "lotId",
  transaction: "transactionInvoiceId",
  purchase: "purchaseInvoiceId",
};
const PREFIX: Record<DocParent, string> = { lot: "lot-docs", transaction: "txn-inv", purchase: "pur-inv" };

type Fail = { ok: false; error: string };

function validate(file: File | null): Fail | { ok: true; ext: string } {
  if (!file || file.size === 0) return { ok: false, error: "No file" };
  if (file.size > MAX_BYTES) return { ok: false, error: "File too large (max 25MB)" };
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!OK_EXT.has(ext)) return { ok: false, error: "Only PDF or image files" };
  return { ok: true, ext };
}

/** Upload a document to a lot, transaction invoice, or purchase invoice. Parents can hold many. */
export async function uploadDocument(formData: FormData) {
  const parent = String(formData.get("parent")) as DocParent;
  const parentId = String(formData.get("parentId"));
  const label = String(formData.get("label") ?? "").trim() || null;
  const file = formData.get("file") as File | null;
  if (!FIELD[parent]) return { ok: false as const, error: "Bad parent" };
  const v = validate(file);
  if (!v.ok) return v;
  const key = `${PREFIX[parent]}/${parentId}-${Date.now()}.${v.ext}`;
  const type = file!.type || (v.ext === "pdf" ? "application/pdf" : `image/${v.ext}`);
  const url = await saveImage(key, Buffer.from(await file!.arrayBuffer()), type);
  const field = FIELD[parent];
  const max = await prisma.document.aggregate({ where: { [field]: parentId }, _max: { seq: true } });
  await prisma.document.create({
    data: { [field]: parentId, label, fileUrl: url, fileName: file!.name, seq: (max._max.seq ?? -1) + 1 },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function deleteDocument(id: string) {
  await prisma.document.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
