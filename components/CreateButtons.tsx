"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "@/components/icons";
import { SkuAvatar } from "@/components/ui";
import { createProduct, createMaterial, uploadEntityImage } from "@/app/catalog/actions";
import { SearchSelect } from "@/components/SearchSelect";
import { COMMON_UNIT_LABELS } from "@/lib/format";
import { useCan } from "@/components/AccessProvider";


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
  const [photo, setPhoto] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const canCreate = useCan("catalog", "create");

  // A local preview of the chosen photo; the object URL is released when it changes or closes.
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function reset() {
    setCode("");
    setName("");
    setPhoto(null);
    setError(null);
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const r = await createProduct({ code, name });
      if (!r.ok) {
        setError(r.error ?? "Failed");
        return;
      }
      // The photo rides the same upload the product page uses, once there is a product to hang it on.
      if (photo && !r.existed) {
        const fd = new FormData();
        fd.set("kind", "product");
        fd.set("id", r.id);
        fd.set("file", photo);
        const up = await uploadEntityImage(fd);
        if (!up.ok) {
          setError(`${r.code} was created, but the photo didn't upload: ${up.error}. Add it from the product page.`);
          router.refresh();
          return;
        }
      }
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setPending(false);
    }
  }

  if (!canCreate) return null;

  return (
    <>
      <AddBtn onClick={() => setOpen(true)}>New SKU</AddBtn>
      {open && (
        <Modal title="New SKU" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <div className="flex items-start gap-4">
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="group relative block overflow-hidden rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  title={photo ? "Change photo" : "Add a photo"}
                >
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="" className="block h-24 w-24 rounded-[10px] border border-border object-cover" />
                  ) : (
                    <SkuAvatar code={code.trim() || "SKU"} size={96} />
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-center text-[10.5px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                    {photo ? "Change" : "Add photo"}
                  </span>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                />
                <div className="mt-1.5 text-center text-[11px] text-muted">
                  {photo ? (
                    <button type="button" onClick={() => setPhoto(null)} className="hover:text-ink">
                      Remove photo
                    </button>
                  ) : (
                    "Photo (optional)"
                  )}
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <Field label="Product name">
                  <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Lavender Hand Cream" />
                </Field>
                <Field label="Abbreviation">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
                    maxLength={8}
                    className={inputCls}
                    placeholder="Your internal code, e.g. LAV"
                  />
                </Field>
              </div>
            </div>
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
              <input type="checkbox" checked={skuSpecific} onChange={(e) => setSkuSpecific(e.target.checked)} className="accent-accent" />
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
