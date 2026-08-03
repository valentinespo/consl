"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, SkuAvatar } from "@/components/ui";
import { ImageUpload } from "@/components/ImageUpload";
import { Field, SaveBar, inputCls } from "@/components/FormKit";
import { updateProduct } from "@/app/catalog/actions";

export type ProductForEdit = {
  id: string;
  code: string;
  name: string;
  notes: string | null;
  standardUnitCost: number | null;
  imageUrl: string | null;
};

export function ProductEditor({ product }: { product: ProductForEdit }) {
  const router = useRouter();
  const [code, setCode] = useState(product.code);
  const [name, setName] = useState(product.name);
  const [notes, setNotes] = useState(product.notes ?? "");
  const [stdCost, setStdCost] = useState(product.standardUnitCost != null ? String(product.standardUnitCost) : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    code.trim().toUpperCase() !== product.code ||
    name.trim() !== product.name ||
    notes.trim() !== (product.notes ?? "") ||
    (stdCost === "" ? null : Number(stdCost) || 0) !== (product.standardUnitCost ?? null);

  function reset() {
    setCode(product.code);
    setName(product.name);
    setNotes(product.notes ?? "");
    setStdCost(product.standardUnitCost != null ? String(product.standardUnitCost) : "");
    setError(null);
  }

  async function save() {
    setError(null);
    setPending(true);
    try {
      const res = await updateProduct({ id: product.id, code, name, notes, standardUnitCost: stdCost === "" ? null : Number(stdCost) || 0 });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Couldn't reach the server — reload to check whether it saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <div className="mb-4 text-[12px] font-medium uppercase tracking-wide text-muted">Details</div>
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="shrink-0">
          <ImageUpload
            kind="product"
            id={product.id}
            url={product.imageUrl}
            fallback={<SkuAvatar code={product.code} size={96} />}
            size={96}
            editable
          />
          <div className="mt-1.5 text-center text-[11px] text-muted">Photo</div>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <Field label="SKU code" hint="Your internal code — any length.">
              <input value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} font-semibold uppercase`} />
            </Field>
            <Field label="Product name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field
            label="Standard unit cost ($)"
            hint="Values channel stock that predates any production history here — real lot costs take over as they accrue. Leave empty once you produce in consl."
          >
            <input
              type="number"
              step="0.01"
              value={stdCost}
              onChange={(e) => setStdCost(e.target.value)}
              placeholder="e.g. 3.40"
              className={`${inputCls} w-40`}
            />
          </Field>
          <Field label="Notes" hint="Internal only — never shown to customers.">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={`${inputCls} h-auto resize-y py-2`}
              placeholder="Anything worth remembering about this product…"
            />
          </Field>
        </div>
      </div>
      <SaveBar dirty={dirty} pending={pending} error={error} saved={saved} onSave={save} onReset={reset} />
    </Card>
  );
}
