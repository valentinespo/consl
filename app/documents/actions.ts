"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { saveImage, deleteStored, safeKeySegment } from "@/lib/storage";
import { checkOwned, type OwnedModel } from "@/lib/ownership";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches serverActions.bodySizeLimit in next.config
const OK_EXT = new Set(["pdf", "png", "jpg", "jpeg", "webp", "gif", "avif"]);

export type DocParent = "lot" | "transaction" | "purchase";
// Object.create(null): a plain literal would let inherited keys like "constructor" pass the guard.
const FIELD: Record<DocParent, "lotId" | "transactionInvoiceId" | "purchaseInvoiceId"> = Object.assign(
  Object.create(null),
  { lot: "lotId", transaction: "transactionInvoiceId", purchase: "purchaseInvoiceId" },
);
const PREFIX: Record<DocParent, string> = Object.assign(Object.create(null), {
  lot: "lot-docs",
  transaction: "txn-inv",
  purchase: "pur-inv",
});
const PARENT_MODEL: Record<DocParent, OwnedModel> = Object.assign(Object.create(null), {
  lot: "lot",
  transaction: "transactionInvoice",
  purchase: "purchaseInvoice",
});

type Fail = { ok: false; error: string };

function validate(file: File | null): Fail | { ok: true; ext: string } {
  if (!file || file.size === 0) return { ok: false, error: "No file" };
  if (file.size > MAX_BYTES) return { ok: false, error: "File too large (max 10MB)" };
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!OK_EXT.has(ext)) return { ok: false, error: "Only PDF or image files" };
  return { ok: true, ext };
}

/** Upload a document to a lot, transaction invoice, or purchase invoice. Parents can hold many. */
export async function uploadDocument(formData: FormData) {
  const parent = String(formData.get("parent")) as DocParent;
  const parentId = String(formData.get("parentId"));
  const label = String(formData.get("label") ?? "").trim().slice(0, 200) || null;
  const file = formData.get("file") as File | null;

  // Validate everything before a single byte is written — the key is built from `parent` and
  // `parentId`, so an unchecked value here becomes an attacker-chosen path on disk.
  if (!FIELD[parent]) return { ok: false as const, error: "Bad parent" };
  const owned = await checkOwned([[PARENT_MODEL[parent], parentId]]);
  if (owned) return owned;
  const v = validate(file);
  if (!v.ok) return v;

  const key = `${PREFIX[parent]}/${safeKeySegment(parentId)}-${Date.now()}.${v.ext}`;
  // Content type comes from the validated extension, never from the client-supplied part header:
  // a .png declaring text/html would be served back as executable HTML.
  const type = v.ext === "pdf" ? "application/pdf" : `image/${v.ext === "jpg" ? "jpeg" : v.ext}`;
  const url = await saveImage(key, Buffer.from(await file!.arrayBuffer()), type);
  const field = FIELD[parent];
  const max = await prisma.document.aggregate({ where: { [field]: parentId }, _max: { seq: true } });
  await prisma.document.create({
    data: {
      [field]: parentId,
      label,
      fileUrl: url,
      fileName: file!.name.slice(0, 255),
      seq: (max._max.seq ?? -1) + 1,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function deleteDocument(id: string) {
  // Read the row first (scoped, so another org's id finds nothing) and drop the stored object
  // too — otherwise the file stays fetchable at its original URL after the user "deletes" it.
  const doc = await prisma.document.findFirst({ where: { id }, select: { id: true, fileUrl: true } });
  if (!doc) return { ok: false as const, error: "Document not found" };
  await prisma.document.delete({ where: { id: doc.id } });
  await deleteStored(doc.fileUrl);
  revalidatePath("/", "layout");
  return { ok: true as const };
}
