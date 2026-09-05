"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Upload, Paperclip } from "@/components/icons";
import { DatePicker } from "@/components/DatePicker";
import { upsertTransactionInvoice, deleteTransactionInvoice, type InvoiceLineInput } from "@/app/transactions/actions";
import { uploadDocument, deleteDocument } from "@/app/documents/actions";
import { DocPreview } from "@/components/DocPreview";
import type { Doc } from "@/components/DocumentList";
import { SearchSelect } from "@/components/SearchSelect";
import { TwoStepDelete } from "@/components/TwoStepDelete";
import { SkuAvatar } from "@/components/ui";
import { useMoney } from "@/components/CurrencyProvider";
import { categoryOptions, isExcludedCategory, SEED_COG_CATEGORIES } from "@/lib/categories";

export type InvLine = {
  id?: string;
  category: string;
  amount: number;
  lotId: string | null;
  lotNr: number | null;
  sku: string | null;
  concept: string | null;
  skuMissing?: boolean;
};
export type InvoiceRow = {
  id: string;
  /** Still being written up: shown in the list, on nobody's books. */
  draft: boolean;
  dateISO: string | null;
  supplier: string | null;
  supplierPhotoUrl?: string | null;
  invoiceTotal: number;
  documents: { id: string; label: string | null; fileUrl: string; fileName: string | null }[];
  applicable: number;
  notApplicable: number;
  unassignedAmount: number;
  presentSkus: { code: string; imageUrl: string | null; missing: boolean }[];
  presentLots: { lotId: string | null; lotNr: number }[];
  presentCats: string[];
  hasUnassigned: boolean;
  hasSkuUnassigned: boolean;
  lines: InvLine[];
};
export type LotOption = { id: string; lotNr: number; label: string; skus: string[] };

const DEFAULT_CATEGORY = SEED_COG_CATEGORIES[0]; // "Ingredients"

type EditLine = { key: string; category: string; amount: string; lotId: string; sku: string; concept: string };

const inputCls =
  "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent-strong";

let keySeq = 0;
const newKey = () => `l${keySeq++}`;

function toEditLines(lines: InvLine[] | undefined, defaultLotId?: string, draft = false): EditLine[] {
  if (lines && lines.length) {
    return lines.map((l) => ({
      key: newKey(),
      category: l.category,
      // A draft keeps what was typed; a blank amount was blank, not zero.
      amount: draft && !l.amount ? "" : String(l.amount ?? ""),
      lotId: l.lotId ?? "",
      sku: l.sku ?? "ALL",
      concept: l.concept ?? "",
    }));
  }
  return [{ key: newKey(), category: DEFAULT_CATEGORY, amount: "", lotId: defaultLotId ?? "", sku: "ALL", concept: "" }];
}

export function TransactionInvoiceForm({
  invoice,
  lots,
  suppliers,
  categories = [],
  skuImages,
  defaultLotId,
  documents = [],
  onDone,
  cancelLabel = "Cancel",
}: {
  invoice?: InvoiceRow | null;
  /** Already-attached documents (edit mode) — removals are staged and applied on Save. */
  documents?: Doc[];
  lots: LotOption[];
  suppliers: string[];
  categories?: string[]; // in-use categories, merged with the seeds for the dropdown
  skuImages?: Record<string, string | null>;
  defaultLotId?: string;
  onDone: () => void;
  cancelLabel?: string;
}) {
  const { money } = useMoney();
  const editing = !!invoice;
  const [supplier, setSupplier] = useState(invoice?.supplier ?? "");
  const [dateISO, setDateISO] = useState(invoice?.dateISO ?? "");
  const [total, setTotal] = useState(invoice && !(invoice.draft && !invoice.invoiceTotal) ? String(invoice.invoiceTotal) : "");
  const [lines, setLines] = useState<EditLine[]>(() => toEditLines(invoice?.lines, defaultLotId, invoice?.draft));
  const [pending, setPending] = useState(false);
  const [delStep, setDelStep] = useState(0); // 0 = idle, 1 = first confirm, 2 = final confirm
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const linesSum = useMemo(() => lines.reduce((s, l) => s + (Number(l.amount) || 0), 0), [lines]);
  const totalNum = Number(total) || 0;
  const remaining = totalNum - linesSum;
  const balanced = Math.abs(remaining) < 0.01;

  // Dropdown = seed categories + any already in use + whatever's typed on this invoice.
  const catOptions = useMemo(
    () => categoryOptions([...categories, ...lines.map((l) => l.category)]),
    [categories, lines],
  );

  // Dirty tracking: compare the current form against the invoice as loaded.
  const lineKey = (c: string, amt: number, lot: string, sku: string, con: string) =>
    `${c}|${amt}|${lot}|${isExcludedCategory(c) ? "" : sku || "ALL"}|${con.trim()}`;
  const currentSnapshot = JSON.stringify({
    s: supplier.trim(),
    d: dateISO,
    t: totalNum,
    l: lines.map((l) => lineKey(l.category, Number(l.amount) || 0, l.lotId, l.sku, l.concept)),
  });
  const originalSnapshot = useMemo(
    () =>
      invoice
        ? JSON.stringify({
            s: (invoice.supplier ?? "").trim(),
            d: invoice.dateISO ?? "",
            t: invoice.invoiceTotal,
            l: invoice.lines.map((l) => lineKey(l.category, l.amount, l.lotId ?? "", l.sku ?? "ALL", l.concept ?? "")),
          })
        : null,
    [invoice],
  );
  // Attachment edits are staged like every other change — new files upload and marked
  // removals delete only when Save is clicked.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = !invoice || currentSnapshot !== originalSnapshot || pendingFiles.length > 0 || removeIds.length > 0;

  // Complete = fit to go on the books: a total, and lines that add up to it. Anything short of
  // that can still be kept as a DRAFT (new invoices and existing drafts only — an invoice already
  // on the books can't slip back off them, so its button just waits for the numbers to balance).
  const complete = balanced && totalNum !== 0;
  const isDraft = !!invoice?.draft;
  const draftable = (!editing || isDraft) && !complete;
  const hasAnything =
    supplier.trim() !== "" || dateISO !== "" || total.trim() !== "" || pendingFiles.length > 0 ||
    lines.some((l) => l.amount.trim() !== "" || l.concept.trim() !== "" || l.lotId !== "" || l.category !== DEFAULT_CATEGORY);

  function patch(key: string, p: Partial<EditLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { key: newKey(), category: DEFAULT_CATEGORY, amount: "", lotId: defaultLotId ?? "", sku: "ALL", concept: "" }]);
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }
  /** Fill the remaining balance into this line's amount. */
  function fillRemaining(key: string) {
    const others = lines.filter((l) => l.key !== key).reduce((s, l) => s + (Number(l.amount) || 0), 0);
    patch(key, { amount: String(Math.round((totalNum - others) * 100) / 100) });
  }

  async function submit(asDraft = false) {
    setError(null);
    if (!asDraft && !balanced) {
      setError(`Lines add up to ${money(linesSum, 2)} but the invoice total is ${money(totalNum, 2)}.`);
      return;
    }
    setPending(true);
    try {
      const payloadLines: InvoiceLineInput[] = lines.map((l) => ({
        category: l.category.trim(),
        amount: Number(l.amount) || 0,
        lotId: l.lotId || null,
        sku: isExcludedCategory(l.category) ? null : l.sku || null,
        concept: l.concept || null,
      }));
      const res = await upsertTransactionInvoice({
        id: invoice?.id ?? null,
        supplierName: supplier.trim() || null,
        dateISO: dateISO || null,
        invoiceTotal: totalNum,
        lines: payloadLines,
        draft: asDraft,
      });
      if (!res.ok) {
        setError(res.error);
        setPending(false);
        return;
      }
      for (const id of removeIds) {
        const dr = await deleteDocument(id);
        if (dr && !dr.ok) {
          setError(`Saved, but removing a document failed: ${dr.error}`);
          setPending(false);
          router.refresh();
          return;
        }
      }
      for (const file of pendingFiles) {
        const fd = new FormData();
        fd.set("parent", "transaction");
        fd.set("parentId", res.id);
        fd.set("label", "");
        fd.set("file", file);
        const up = await uploadDocument(fd);
        if (up && !up.ok) {
          setError(`Saved, but attaching “${file.name}” failed: ${up.error}`);
          setPending(false);
          router.refresh();
          return;
        }
      }
      setPendingFiles([]);
      setRemoveIds([]);
      onDone();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setPending(false);
    }
  }
  async function remove() {
    if (!invoice) return;
    setPending(true);
    await deleteTransactionInvoice(invoice.id);
    onDone();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {isDraft && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-ink-soft">
          <span className="pill-neutral inline-flex items-center rounded-full border px-2 py-[2px] text-[11px] font-medium uppercase tracking-wide">Draft</span>
          Not on the books yet — nothing here reaches a lot or the costing. Enter the total, balance the lines and Save &amp; recompute to post it.
        </div>
      )}
      {/* Invoice documents — where the old card sat. Everything here is STAGED: new files upload
          and marked removals delete only when Save is clicked, like any other edit. */}
      <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[12px] font-medium uppercase tracking-wide text-muted">Invoice documents</span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-soft hover:border-accent-strong"
          >
            <Upload size={13} /> Attach file
          </button>
        </div>
        {documents.length === 0 && pendingFiles.length === 0 && (
          <div className="text-[12px] text-muted">No invoice attached yet — attachments upload when you save.</div>
        )}
        <div className="space-y-1.5">
          {documents.map((d) => {
            const marked = removeIds.includes(d.id);
            return (
              <div key={d.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${marked ? "border-[#f0d3cb] bg-[#fdf2ef]" : "border-border bg-surface"}`}>
                <Paperclip size={13} className="shrink-0 text-muted" />
                <span className={`min-w-0 truncate text-[12.5px] ${marked ? "text-negative line-through" : "text-ink-soft"}`} title={d.fileName ?? ""}>
                  {d.fileName ?? "document"}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2.5">
                  {marked ? (
                    <>
                      <span className="text-[11px] text-negative">removed on save</span>
                      <button type="button" onClick={() => setRemoveIds((prev) => prev.filter((x) => x !== d.id))} className="text-[11.5px] font-medium text-ink-soft hover:underline">
                        Undo
                      </button>
                    </>
                  ) : (
                    <>
                      <DocPreview url={d.fileUrl} name={d.fileName ?? "Document"} />
                      <button type="button" onClick={() => setRemoveIds((prev) => [...prev, d.id])} className="text-muted hover:text-negative" title="Remove (applies on save)">
                        <X size={13} />
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
          {pendingFiles.map((file, i) => (
            <div key={`new-${file.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-dashed border-accent/40 bg-accent-soft/30 px-2.5 py-1.5">
              <Paperclip size={13} className="shrink-0 text-accent" />
              <span className="min-w-0 truncate text-[12.5px] text-ink-soft">{file.name}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2.5">
                <span className="text-[11px] text-muted">uploads on save</span>
                <button type="button" onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))} className="text-muted hover:text-negative" title="Remove">
                  <X size={13} />
                </button>
              </span>
            </div>
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          multiple
          hidden
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length) setPendingFiles((prev) => [...prev, ...picked]);
            e.target.value = "";
          }}
        />
      </div>

      {/* Invoice header */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Supplier">
          <SearchSelect
            value={supplier}
            onChange={setSupplier}
            options={suppliers}
            placeholder="Select supplier…"
            createLabel="Create new supplier"
            createPlaceholder="Name the supplier, then press Enter"
          />
        </Field>
        <Field label="Date">
          <DatePicker value={dateISO} onChange={setDateISO} />
        </Field>
        <Field label="Invoice total ($)">
          <input
            type="number"
            step="0.01"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            placeholder="0.00"
            className={`${inputCls} font-semibold tabular`}
          />
        </Field>
      </div>

      {/* Allocation lines */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-muted">Allocation lines</span>
          <span className={`text-[12px] tabular ${balanced ? "text-positive" : "text-negative"}`}>
            {balanced ? "✓ Balanced" : `${money(linesSum, 2)} of ${money(totalNum, 2)} · ${remaining > 0 ? "remaining " : "over by "}${money(Math.abs(remaining), 2)}`}
          </span>
        </div>

        {lines.map((l) => {
          const na = isExcludedCategory(l.category);
          const lot = lots.find((x) => x.id === l.lotId);
          const lotSkus = lot?.skus ?? [];
          const lotUnassigned = !na && !l.lotId;
          const skuDangling = !na && !!l.lotId && !!l.sku && l.sku !== "ALL" && !lotSkus.includes(l.sku);
          const orphaned = lotUnassigned || skuDangling;
          return (
            <div
              key={l.key}
              className={`rounded-lg border p-2.5 ${na || orphaned ? "border-[#f0d3cb] bg-[#fdf2ef]" : "border-border bg-surface"}`}
            >
              <div className="flex flex-wrap items-end gap-2">
                <MiniField label="Category" className="w-[150px]">
                  <SearchSelect
                    value={l.category}
                    onChange={(v) => patch(l.key, { category: v })}
                    options={catOptions}
                    placeholder="Category…"
                    createLabel="Create new category"
                    createPlaceholder="Name the category, then press Enter"
                  />
                </MiniField>

                {!na && (
                  <>
                    <MiniField label="Lot" className="min-w-[150px] flex-1">
                      <select value={l.lotId} onChange={(e) => patch(l.key, { lotId: e.target.value, sku: "ALL" })} className={inputCls}>
                        {/* "Unassigned" is a consequence of deletion, never a deliberate choice. */}
                        {lotUnassigned && <option value="" disabled>⚠ Unassigned — pick a lot</option>}
                        {lots.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    </MiniField>
                    <MiniField label="SKU" className="w-[210px]">
                      <div className="flex items-center gap-2">
                        {l.sku && l.sku !== "ALL" && !skuDangling && <SkuAvatar code={l.sku} imageUrl={skuImages?.[l.sku] ?? null} size={26} />}
                        <div className="min-w-0 flex-1">
                          <select value={l.sku} onChange={(e) => patch(l.key, { sku: e.target.value })} className={inputCls}>
                            <option value="ALL">Spread proportionally</option>
                            {lotSkus.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                            {skuDangling && (
                              <option value={l.sku!} disabled>
                                ⚠ {l.sku} — removed, reassign
                              </option>
                            )}
                          </select>
                        </div>
                      </div>
                    </MiniField>
                  </>
                )}

                <MiniField label="Amount ($)" className="w-[110px]">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.01"
                      value={l.amount}
                      onChange={(e) => patch(l.key, { amount: e.target.value })}
                      placeholder="0.00"
                      className={`${inputCls} text-right tabular`}
                    />
                  </div>
                </MiniField>

                {confirmRemove === l.key ? (
                  <button
                    type="button"
                    onClick={() => {
                      removeLine(l.key);
                      setConfirmRemove(null);
                    }}
                    title="Click to confirm removal"
                    className="mb-0.5 whitespace-nowrap rounded-lg bg-negative px-2 py-2 text-[11.5px] font-medium text-white hover:opacity-90"
                  >
                    Remove?
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(l.key)}
                    title="Remove line"
                    className="mb-0.5 inline-flex h-9 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-negative disabled:opacity-30"
                    disabled={lines.length === 1}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={l.concept}
                  onChange={(e) => patch(l.key, { concept: e.target.value })}
                  placeholder={na ? "What is this (e.g. USDA certification)?" : "Concept / note"}
                  className={`${inputCls} flex-1`}
                />
                <button
                  type="button"
                  onClick={() => fillRemaining(l.key)}
                  className="whitespace-nowrap rounded-lg border border-border px-2.5 py-2 text-[11.5px] text-muted hover:bg-surface-2 hover:text-ink-soft"
                  title="Set this line to the remaining balance"
                >
                  Fill rest
                </button>
              </div>
              {orphaned && (
                <p className="mt-2 text-[11.5px] font-medium text-negative">
                  ⚠ {lotUnassigned ? "Lot was deleted" : `SKU “${l.sku}” was removed from this lot`} — excluded from COG until reassigned.
                </p>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={addLine}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-surface-2"
        >
          <Plus size={14} /> Add line
        </button>
      </div>

      {error && <div className="rounded-lg border border-[#f0d3cb] bg-[#fdf2ef] px-3 py-2 text-[12.5px] text-negative">{error}</div>}

      <div className="flex items-center justify-between pt-1">
        <div>
          {editing && (
            <TwoStepDelete step={delStep} setStep={setDelStep} pending={pending} onConfirm={remove} noun="invoice" />
          )}
        </div>
        <div className="flex gap-2">
          {editing && dirty ? (
            <button type="button" onClick={onDone} className="rounded-lg border border-[#e7cfc8] px-3.5 py-2 text-[13px] font-medium text-negative hover:bg-[#fbf1ee]">
              Cancel changes
            </button>
          ) : (
            <button type="button" onClick={onDone} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
              {cancelLabel}
            </button>
          )}
          {draftable ? (
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={pending || !hasAnything || (editing && !dirty)}
              className="rounded-lg border border-border bg-surface px-3.5 py-2 text-[13px] font-medium text-ink-soft hover:bg-surface-2 disabled:opacity-50"
              title={editing && !dirty ? "No changes to save" : !hasAnything ? "Nothing to keep yet" : "Kept off the books until the lines add up to the total"}
            >
              {pending ? "Saving…" : "Save as draft"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={pending || !complete || (editing && !dirty)}
              className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
              title={editing && !dirty ? "No changes to save" : !balanced ? "Lines must sum to the invoice total" : undefined}
            >
              {pending ? "Saving…" : editing && !isDraft ? "Save changes" : "Save & recompute"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
function MiniField({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10.5px] font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}
