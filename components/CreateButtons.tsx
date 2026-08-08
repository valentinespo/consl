"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "@/components/icons";
import { createProduct, createMaterial, importAmazonCatalog } from "@/app/catalog/actions";
import { SearchSelect } from "@/components/SearchSelect";
import { COMMON_UNIT_LABELS } from "@/lib/format";
import { useCan } from "@/components/AccessProvider";

/** Catalog bootstrap: pull the org's live FBA SKUs into the catalog — each mapped, given a unique
 *  3-letter abbreviation, and (best-effort) Amazon's main image. Idempotent server-side. */
export function ImportAmazonCatalogButton() {
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();
  const canCreate = useCan("catalog", "create");
  if (!canCreate) return null;

  async function run() {
    setPending(true);
    setConfirming(false);
    setNote(null);
    try {
      const r = await importAmazonCatalog();
      if (!r.ok) {
        setNote(r.error ?? "Import failed");
        return;
      }
      setNote(
        r.created > 0
          ? `Imported ${r.created} product${r.created > 1 ? "s" : ""}${r.images > 0 ? ` (${r.images} with photos)` : ""}.`
          : "Nothing new — every Amazon SKU is already in the catalog.",
      );
      router.refresh();
    } catch {
      setNote("Couldn't reach the server — reload and check the catalog.");
    } finally {
      setPending(false);
    }
  }

  // Two-step: the first click asks to confirm (a stray click can't import a pile of listings), the
  // second actually runs it.
  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-[12px] text-ink-soft">Import every Amazon SKU not already in your catalog?</span>
        <button
          onClick={run}
          disabled={pending}
          className="rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Importing…" : "Yes, import"}
        </button>
        <button onClick={() => setConfirming(false)} disabled={pending} className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-muted hover:text-ink disabled:opacity-40">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {note && <span className="text-[12px] text-muted">{note}</span>}
      <button
        onClick={() => { setNote(null); setConfirming(true); }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-surface-2"
      >
        Import from Amazon
      </button>
    </span>
  );
}

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
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90">
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
  const canCreate = useCan("catalog", "create");

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

  if (!canCreate) return null;

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
              <button onClick={save} disabled={pending || !code.trim()} className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-40">
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
  const [skuSpecific, setSkuSpecific] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const canCreate = useCan("catalog", "create");

  async function save() {
    setPending(true);
    setError(null);
    const r = await createMaterial({ name, unitLabel, skuSpecific });
    setPending(false);
    if (!r.ok) {
      setError(r.error ?? "Failed");
      return;
    }
    setOpen(false);
    setName("");
    setUnitLabel("");
    setSkuSpecific(false);
    router.refresh();
  }

  if (!canCreate) return null;

  return (
    <>
      <AddBtn onClick={() => setOpen(true)}>New material</AddBtn>
      {open && (
        <Modal title="New raw material" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <Field label="Material name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Box sleeve" />
            </Field>
            {/* Consumption rates are set on the first lot that uses the material and inherited by
                later lots — no per-unit default at the catalog level. */}
            <Field label="Unit label">
              <SearchSelect
                value={unitLabel}
                onChange={setUnitLabel}
                options={COMMON_UNIT_LABELS}
                placeholder="How you count it"
                createLabel="Use a different unit"
                createPlaceholder="Type the unit, then press Enter"
              />
            </Field>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
              <input type="checkbox" checked={skuSpecific} onChange={(e) => setSkuSpecific(e.target.checked)} className="accent-[#1a2f18]" />
              SKU-specific (separate stock per product, like pouches)
            </label>
            {error && <div className="text-[12px] text-negative">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
                Cancel
              </button>
              <button onClick={save} disabled={pending || !name.trim()} className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-40">
                {pending ? "Saving…" : "Create material"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
