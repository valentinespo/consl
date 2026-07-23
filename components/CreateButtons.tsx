"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { createProduct, createMaterial } from "@/app/catalog/actions";

const inputCls = "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent-strong";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function AddBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90">
      <Plus size={15} /> {children}
    </button>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function NewProductButton() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function save() {
    setPending(true);
    setError(null);
    const r = await createProduct({ code, name });
    setPending(false);
    if (!r.ok) {
      setError(r.error ?? "Failed");
      return;
    }
    setOpen(false);
    setCode("");
    setName("");
    router.refresh();
  }

  return (
    <>
      <AddBtn onClick={() => setOpen(true)}>New SKU</AddBtn>
      {open && (
        <Modal title="New SKU" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <Field label="SKU code">
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={inputCls} placeholder="Your internal code" />
            </Field>
            <Field label="Product name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Lavender Hand Cream" />
            </Field>
            {error && <div className="text-[12px] text-negative">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
                Cancel
              </button>
              <button onClick={save} disabled={pending || !code.trim()} className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40">
                {pending ? "Saving…" : "Create SKU"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export function NewMaterialButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [unitLabel, setUnitLabel] = useState("");
  const [perUnit, setPerUnit] = useState("1");
  const [skuSpecific, setSkuSpecific] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function save() {
    setPending(true);
    setError(null);
    const r = await createMaterial({ name, unitLabel, defaultPerUnit: Number(perUnit) || 1, skuSpecific });
    setPending(false);
    if (!r.ok) {
      setError(r.error ?? "Failed");
      return;
    }
    setOpen(false);
    setName("");
    setUnitLabel("");
    setPerUnit("1");
    setSkuSpecific(false);
    router.refresh();
  }

  return (
    <>
      <AddBtn onClick={() => setOpen(true)}>New material</AddBtn>
      {open && (
        <Modal title="New raw material" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <Field label="Material name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Box sleeve" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Unit label">
                <input value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} className={inputCls} placeholder="unit / box / label" />
              </Field>
              <Field label="Default per finished unit">
                <input type="number" step="any" value={perUnit} onChange={(e) => setPerUnit(e.target.value)} className={inputCls} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
              <input type="checkbox" checked={skuSpecific} onChange={(e) => setSkuSpecific(e.target.checked)} className="accent-[#1a2f18]" />
              SKU-specific (separate stock per product, like pouches)
            </label>
            {error && <div className="text-[12px] text-negative">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
                Cancel
              </button>
              <button onClick={save} disabled={pending || !name.trim()} className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40">
                {pending ? "Saving…" : "Create material"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
