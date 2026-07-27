"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { useMoney } from "@/components/CurrencyProvider";
import { upsertPurchaseInvoice, deletePurchaseInvoice, type PurchaseLineInput } from "@/app/purchases/actions";
import { SelectOrCreate, type Opt } from "@/components/SelectOrCreate";
import { SearchSelect } from "@/components/SearchSelect";
import { SkuAvatar } from "@/components/ui";
import { TwoStepDelete } from "@/components/TwoStepDelete";

export type PurchaseInvoiceRow = {
  id: string;
  dateISO: string;
  supplier: string | null;
  supplierPhotoUrl?: string | null;
  invoiceTotal: number;
  documents: { id: string; label: string | null; fileUrl: string; fileName: string | null }[];
  totalQty: number;
  facilities: string[];
  skus: { code: string; imageUrl: string | null }[];
  lines: {
    id: string;
    facilityId: string;
    facility: string;
    productId: string | null;
    sku: string | null;
    imageUrl: string | null;
    quantity: number;
    unitCost: number;
    total: number;
  }[];
};

export type PurchaseMaterial = { id: string; code: string; name: string; unitLabel: string; skuSpecific: boolean };
export type PurchaseOptions = {
  facilities: { id: string; code: string; name: string }[];
  products: { id: string; code: string; name: string; imageUrl: string | null }[];
  suppliers: string[];
};

type EditLine = { key: string; facilityId: string; productId: string; quantity: string; total: string };

const inputCls = "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent-strong";

let keySeq = 0;
const newKey = () => `p${keySeq++}`;

function toEditLines(invoice: PurchaseInvoiceRow | undefined, options: PurchaseOptions): EditLine[] {
  if (invoice && invoice.lines.length) {
    return invoice.lines.map((l) => ({ key: newKey(), facilityId: l.facilityId, productId: l.productId ?? "", quantity: String(l.quantity), total: String(l.total) }));
  }
  return [{ key: newKey(), facilityId: options.facilities[0]?.id ?? "", productId: options.products[0]?.id ?? "", quantity: "", total: "" }];
}

export function PurchaseInvoiceForm({
  material,
  options,
  invoice,
  onDone,
  cancelLabel = "Cancel",
}: {
  material: PurchaseMaterial;
  options: PurchaseOptions;
  invoice?: PurchaseInvoiceRow | null;
  onDone: () => void;
  cancelLabel?: string;
}) {
  const { money, costFine } = useMoney();
  const editing = !!invoice;
  const [supplier, setSupplier] = useState(invoice?.supplier ?? "");
  const [dateISO, setDateISO] = useState(invoice?.dateISO ?? "");
  const [total, setTotal] = useState(invoice ? String(invoice.invoiceTotal) : "");
  const [lines, setLines] = useState<EditLine[]>(() => toEditLines(invoice ?? undefined, options));
  const [pending, setPending] = useState(false);
  const [delStep, setDelStep] = useState(0); // 0 = idle, 1 = first confirm, 2 = final confirm
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const linesSum = useMemo(() => lines.reduce((s, l) => s + (Number(l.total) || 0), 0), [lines]);
  const totalNum = Number(total) || 0;
  const remaining = totalNum - linesSum;
  const balanced = Math.abs(remaining) < 0.01;

  // Dirty tracking: compare the current form against the invoice as loaded.
  const lineKey = (fac: string, prod: string, q: number, t: number) =>
    `${fac}|${material.skuSpecific ? prod : ""}|${q}|${t}`;
  const currentSnapshot = JSON.stringify({
    s: supplier.trim(),
    d: dateISO,
    t: totalNum,
    l: lines.map((l) => lineKey(l.facilityId, l.productId, Number(l.quantity) || 0, Number(l.total) || 0)),
  });
  const originalSnapshot = useMemo(
    () =>
      invoice
        ? JSON.stringify({
            s: (invoice.supplier ?? "").trim(),
            d: invoice.dateISO ?? "",
            t: invoice.invoiceTotal,
            l: invoice.lines.map((l) => lineKey(l.facilityId, l.productId ?? "", l.quantity, l.total)),
          })
        : null,
    [invoice],
  );
  const dirty = !invoice || currentSnapshot !== originalSnapshot;

  const productOpts: Opt[] = options.products.map((p) => ({ value: p.id, label: p.code }));

  function patch(key: string, p: Partial<EditLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { key: newKey(), facilityId: options.facilities[0]?.id ?? "", productId: options.products[0]?.id ?? "", quantity: "", total: "" }]);
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }
  function fillRemaining(key: string) {
    const others = lines.filter((l) => l.key !== key).reduce((s, l) => s + (Number(l.total) || 0), 0);
    patch(key, { total: String(Math.round((totalNum - others) * 100) / 100) });
  }

  async function submit() {
    setError(null);
    if (!balanced) {
      setError(`Lines add up to ${money(linesSum, 2)} but the invoice total is ${money(totalNum, 2)}.`);
      return;
    }
    setPending(true);
    try {
      const payloadLines: PurchaseLineInput[] = lines.map((l) => ({
        facilityId: l.facilityId,
        productId: material.skuSpecific ? l.productId || null : null,
        quantity: Number(l.quantity) || 0,
        total: Number(l.total) || 0,
      }));
      const res = await upsertPurchaseInvoice({
        id: invoice?.id ?? null,
        materialTypeId: material.id,
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
    await deletePurchaseInvoice(invoice.id);
    onDone();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Supplier">
          <SearchSelect
            value={supplier}
            onChange={setSupplier}
            options={options.suppliers}
            placeholder="Select supplier…"
            createLabel="Create new supplier"
            createPlaceholder="Name the supplier, then press Enter"
          />
        </Field>
        <Field label="Date">
          <input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Invoice total ($)">
          <input type="number" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0.00" className={`${inputCls} font-semibold tabular`} />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-muted">
            {material.name} lines <span className="text-muted/70">· one material per invoice</span>
          </span>
          <span className={`text-[12px] tabular ${balanced ? "text-positive" : "text-negative"}`}>
            {balanced ? "✓ Balanced" : `${money(linesSum, 2)} of ${money(totalNum, 2)} · ${remaining > 0 ? "remaining " : "over by "}${money(Math.abs(remaining), 2)}`}
          </span>
        </div>

        {lines.map((l) => {
          const q = Number(l.quantity) || 0;
          const unit = q ? (Number(l.total) || 0) / q : 0;
          const prod = options.products.find((p) => p.id === l.productId);
          return (
            <div key={l.key} className="rounded-lg border border-border bg-surface p-2.5">
              <div className="flex flex-wrap items-end gap-2">
                <MiniField label="Facility" className={material.skuSpecific ? "w-[88px]" : "min-w-[120px] flex-1"}>
                  <select value={l.facilityId} onChange={(e) => patch(l.key, { facilityId: e.target.value })} className={inputCls}>
                    {options.facilities.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.code}
                      </option>
                    ))}
                  </select>
                </MiniField>
                {material.skuSpecific && (
                  <MiniField label="SKU" className="min-w-[160px] flex-1">
                    <div className="flex items-center gap-2">
                      {prod && <SkuAvatar code={prod.code} imageUrl={prod.imageUrl} size={28} />}
                      <div className="min-w-0 flex-1">
                        <SelectOrCreate value={l.productId} onChange={(v) => patch(l.key, { productId: v })} options={productOpts} />
                      </div>
                    </div>
                  </MiniField>
                )}
                <MiniField label={`Qty (${material.unitLabel}s)`} className="w-[100px]">
                  <input type="number" step="any" value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} placeholder="0" className={`${inputCls} text-right tabular`} />
                </MiniField>
                <MiniField label="Amount ($)" className="w-[120px]">
                  <input type="number" step="0.01" value={l.total} onChange={(e) => patch(l.key, { total: e.target.value })} placeholder="0.00" className={`${inputCls} text-right tabular`} />
                </MiniField>
                <MiniField label={`/ ${material.unitLabel}`} className="w-[78px]">
                  <div className="flex h-9 items-center justify-end rounded-lg border border-line bg-surface px-2 text-[12px] tabular text-muted">{unit ? costFine(unit) : "—"}</div>
                </MiniField>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => fillRemaining(l.key)} className="mb-0.5 whitespace-nowrap rounded-lg border border-border px-2 py-2 text-[11.5px] text-muted hover:bg-surface-2 hover:text-ink-soft" title="Set to remaining balance">
                    Fill rest
                  </button>
                  {confirmRemove === l.key ? (
                    <button type="button" onClick={() => { removeLine(l.key); setConfirmRemove(null); }} className="mb-0.5 whitespace-nowrap rounded-lg bg-negative px-2 py-2 text-[11.5px] font-medium text-white hover:opacity-90" title="Click to confirm removal">
                      Remove?
                    </button>
                  ) : (
                    <button type="button" onClick={() => setConfirmRemove(l.key)} disabled={lines.length === 1} title="Remove line" className="mb-0.5 inline-flex h-9 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-negative disabled:opacity-30">
                      <X size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <button type="button" onClick={addLine} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-surface-2">
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
          <button type="button" onClick={submit} disabled={pending || !balanced || totalNum === 0 || (editing && !dirty)} className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50" title={editing && !dirty ? "No changes to save" : !balanced ? "Lines must sum to the invoice total" : undefined}>
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
