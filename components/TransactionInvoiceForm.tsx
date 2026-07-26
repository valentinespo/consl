"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { upsertTransactionInvoice, deleteTransactionInvoice, type InvoiceLineInput } from "@/app/transactions/actions";
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

function toEditLines(lines: InvLine[] | undefined, defaultLotId?: string): EditLine[] {
  if (lines && lines.length) {
    return lines.map((l) => ({
      key: newKey(),
      category: l.category,
      amount: String(l.amount ?? ""),
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
  onDone,
  cancelLabel = "Cancel",
}: {
  invoice?: InvoiceRow | null;
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
  const [total, setTotal] = useState(invoice ? String(invoice.invoiceTotal) : "");
  const [lines, setLines] = useState<EditLine[]>(() => toEditLines(invoice?.lines, defaultLotId));
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
  const dirty = !invoice || currentSnapshot !== originalSnapshot;

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

  async function submit() {
    setError(null);
    if (!balanced) {
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
      });
      if (!res.ok) {
        setError(res.error);
        setPending(false);
        return;
      }
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
      {/* Invoice header */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Supplier">
          <SearchSelect value={supplier} onChange={setSupplier} options={suppliers} placeholder="Select supplier…" />
        </Field>
        <Field label="Date">
          <input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} className={inputCls} />
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
                    createLabel={(t) => `+ New category “${t}”`}
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
          <button
            type="button"
            onClick={submit}
            disabled={pending || !balanced || totalNum === 0 || (editing && !dirty)}
            className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            title={editing && !dirty ? "No changes to save" : !balanced ? "Lines must sum to the invoice total" : undefined}
          >
            {pending ? "Saving…" : editing ? "Save changes" : "Save & recompute"}
          </button>
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
