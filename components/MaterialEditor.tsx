"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Package } from "lucide-react";
import { Card } from "@/components/ui";
import { ImageUpload } from "@/components/ImageUpload";
import { Field, SaveBar, inputCls } from "@/components/FormKit";
import { updateMaterial } from "@/app/catalog/actions";

export type MaterialForEdit = {
  id: string;
  code: string;
  name: string;
  unitLabel: string;
  defaultPerUnit: number;
  lowStockThreshold: number | null;
  imageUrl: string | null;
};

export function MaterialEditor({ material }: { material: MaterialForEdit }) {
  const router = useRouter();
  const [code, setCode] = useState(material.code);
  const [name, setName] = useState(material.name);
  const [unitLabel, setUnitLabel] = useState(material.unitLabel);
  const [perUnit, setPerUnit] = useState(String(material.defaultPerUnit));
  const [threshold, setThreshold] = useState(material.lowStockThreshold != null ? String(material.lowStockThreshold) : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const thresholdValue = threshold.trim() === "" ? null : Number(threshold);
  const dirty =
    code.trim().toUpperCase() !== material.code ||
    name.trim() !== material.name ||
    unitLabel.trim() !== material.unitLabel ||
    (Number(perUnit) || 0) !== material.defaultPerUnit ||
    thresholdValue !== material.lowStockThreshold;

  function reset() {
    setCode(material.code);
    setName(material.name);
    setUnitLabel(material.unitLabel);
    setPerUnit(String(material.defaultPerUnit));
    setThreshold(material.lowStockThreshold != null ? String(material.lowStockThreshold) : "");
    setError(null);
  }

  async function save() {
    setError(null);
    setPending(true);
    const res = await updateMaterial({
      id: material.id,
      code,
      name,
      unitLabel,
      defaultPerUnit: Number(perUnit) || 1,
      lowStockThreshold: thresholdValue,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <Card>
      <div className="mb-4 text-[12px] font-medium uppercase tracking-wide text-muted">Details</div>
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="shrink-0">
          <ImageUpload
            kind="material"
            id={material.id}
            url={material.imageUrl}
            fallback={<Package size={38} className="text-muted" />}
            size={96}
            editable
          />
          <div className="mt-1.5 text-center text-[11px] text-muted">Photo</div>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <Field label="Code" hint="Short reference for this material.">
              <input value={code} onChange={(e) => setCode(e.target.value)} className={`${inputCls} font-semibold uppercase`} />
            </Field>
            <Field label="Material name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Unit label" hint="How you count it.">
              <input value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} placeholder="unit" className={inputCls} />
            </Field>
            <Field label="Default per finished unit" hint={`${unitLabel || "unit"}s used per product unit.`}>
              <input value={perUnit} onChange={(e) => setPerUnit(e.target.value)} type="number" step="any" min="0" className={`${inputCls} tabular`} />
            </Field>
            <Field label="Low-stock alert" hint="Blank turns the alert off.">
              <input value={threshold} onChange={(e) => setThreshold(e.target.value)} type="number" step="any" min="0" placeholder="off" className={`${inputCls} tabular`} />
            </Field>
          </div>
        </div>
      </div>
      <SaveBar dirty={dirty} pending={pending} error={error} saved={saved} onSave={save} onReset={reset} />
    </Card>
  );
}
