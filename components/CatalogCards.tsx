"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Card, SkuAvatar } from "@/components/ui";
import { ImageUpload } from "@/components/ImageUpload";
import { updateProduct, updateMaterial } from "@/app/catalog/actions";

const inputCls = "h-8 w-full rounded-lg border border-border bg-surface px-2 text-[13px] text-ink outline-none focus:border-accent-strong";

export function EditableProductCard({ product }: { product: { id: string; code: string; name: string; imageUrl: string | null } }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(product.code);
  const [name, setName] = useState(product.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = code.trim().toUpperCase() !== product.code || name.trim() !== product.name;

  async function save() {
    setError(null);
    setPending(true);
    const res = await updateProduct({ id: product.id, code, name });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }
  function cancel() {
    setCode(product.code);
    setName(product.name);
    setError(null);
    setEditing(false);
  }

  return (
    <Card className="relative flex items-center gap-3">
      <ImageUpload kind="product" id={product.id} url={product.imageUrl} fallback={<SkuAvatar code={product.code} size={56} />} size={56} editable={editing} />
      {editing ? (
        <div className="min-w-0 flex-1 space-y-1.5">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" className={`${inputCls} font-semibold uppercase`} />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={inputCls} />
          {error && <div className="text-[11px] text-negative">{error}</div>}
          <div className="flex gap-1.5 pt-0.5">
            <button onClick={save} disabled={pending || !dirty} className="rounded-lg bg-ink px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-40">
              {pending ? "…" : "Save"}
            </button>
            <button onClick={cancel} disabled={pending} className="rounded-lg border border-border px-2.5 py-1 text-[12px] text-ink-soft hover:bg-surface-2">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-ink">{product.code}</div>
            <div className="truncate text-[12.5px] text-muted">{product.name}</div>
          </div>
          <button onClick={() => setEditing(true)} title="Edit SKU" className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink-soft">
            <Pencil size={14} />
          </button>
        </>
      )}
    </Card>
  );
}

export function EditableMaterialCard({
  material,
}: {
  material: { id: string; code: string; name: string; unitLabel: string; defaultPerUnit: number; imageUrl: string | null };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(material.name);
  const [unitLabel, setUnitLabel] = useState(material.unitLabel);
  const [defaultPerUnit, setDefaultPerUnit] = useState(String(material.defaultPerUnit));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = name.trim() !== material.name || unitLabel.trim() !== material.unitLabel || (Number(defaultPerUnit) || 0) !== material.defaultPerUnit;

  async function save() {
    setError(null);
    setPending(true);
    const res = await updateMaterial({ id: material.id, name, unitLabel, defaultPerUnit: Number(defaultPerUnit) || 1 });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }
  function cancel() {
    setName(material.name);
    setUnitLabel(material.unitLabel);
    setDefaultPerUnit(String(material.defaultPerUnit));
    setError(null);
    setEditing(false);
  }

  return (
    <Card className="relative flex items-center gap-3">
      <ImageUpload
        kind="material"
        id={material.id}
        url={material.imageUrl}
        fallback={<span className="text-2xl">{material.code === "TEABAG" ? "🍵" : "📦"}</span>}
        size={56}
        editable={editing}
      />
      {editing ? (
        <div className="min-w-0 flex-1 space-y-1.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={`${inputCls} font-semibold`} />
          <div className="flex gap-1.5">
            <input value={defaultPerUnit} onChange={(e) => setDefaultPerUnit(e.target.value)} type="number" step="any" min="0" placeholder="Rate" className={`${inputCls} w-16 text-right tabular`} />
            <input value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} placeholder="unit label" className={inputCls} />
          </div>
          <div className="text-[10.5px] text-muted">default per finished unit · code {material.code} (fixed)</div>
          {error && <div className="text-[11px] text-negative">{error}</div>}
          <div className="flex gap-1.5 pt-0.5">
            <button onClick={save} disabled={pending || !dirty} className="rounded-lg bg-ink px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-40">
              {pending ? "…" : "Save"}
            </button>
            <button onClick={cancel} disabled={pending} className="rounded-lg border border-border px-2.5 py-1 text-[12px] text-ink-soft hover:bg-surface-2">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-ink">{material.name}</div>
            <div className="truncate text-[12.5px] text-muted">{material.defaultPerUnit} {material.unitLabel}/unit default</div>
          </div>
          <button onClick={() => setEditing(true)} title="Edit material" className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink-soft">
            <Pencil size={14} />
          </button>
        </>
      )}
    </Card>
  );
}
