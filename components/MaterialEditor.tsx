"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Lock } from "@/components/icons";
import { Card } from "@/components/ui";
import { ImageUpload } from "@/components/ImageUpload";
import { Field, SaveBar, inputCls } from "@/components/FormKit";
import { SearchSelect } from "@/components/SearchSelect";
import { COMMON_UNIT_LABELS } from "@/lib/format";
import { updateMaterial } from "@/app/catalog/actions";

export type MaterialForEdit = {
  id: string;
  name: string;
  unitLabel: string;
  lowStockThreshold: number | null;
  skuSpecific: boolean;
  imageUrl: string | null;
};

/** `locked` = the material already has purchases/lots/movements, so per-SKU stocking can't change. */
export function MaterialEditor({ material, locked }: { material: MaterialForEdit; locked: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(material.name);
  const [unitLabel, setUnitLabel] = useState(material.unitLabel);
  const [threshold, setThreshold] = useState(material.lowStockThreshold != null ? String(material.lowStockThreshold) : "");
  const [skuSpecific, setSkuSpecific] = useState(material.skuSpecific);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The material's own label always appears in the list, so a custom one stays selectable.
  const unitOptions = COMMON_UNIT_LABELS.includes(material.unitLabel)
    ? COMMON_UNIT_LABELS
    : [material.unitLabel, ...COMMON_UNIT_LABELS];

  const thresholdValue = threshold.trim() === "" ? null : Number(threshold);
  const dirty =
    name.trim() !== material.name ||
    unitLabel.trim() !== material.unitLabel ||
    thresholdValue !== material.lowStockThreshold ||
    skuSpecific !== material.skuSpecific;

  function reset() {
    setName(material.name);
    setUnitLabel(material.unitLabel);
    setThreshold(material.lowStockThreshold != null ? String(material.lowStockThreshold) : "");
    setSkuSpecific(material.skuSpecific);
    setError(null);
  }

  async function save() {
    setError(null);
    setPending(true);
    try {
      const res = await updateMaterial({
        id: material.id,
        name,
        unitLabel,
        lowStockThreshold: thresholdValue,
        skuSpecific,
      });
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
          {/* No Code field: the material's code is an internal FIFO pool key, generated once at
              creation and never shown — every surface displays the name instead. Leaving it
              editable also risked a full cost recompute, since lot cost snapshots are labelled
              by code. */}
          <Field label="Material name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
          {/* Consumption rates live on each lot's bill of materials now (first lot sets the recipe,
              later lots inherit it), so there's no per-unit default here anymore. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Unit label" hint="How you count it.">
              <SearchSelect
                value={unitLabel}
                onChange={setUnitLabel}
                options={unitOptions}
                placeholder="unit"
                createLabel="Use a different unit"
                createPlaceholder="Type the unit, then press Enter"
              />
            </Field>
            <Field label="Low-stock alert" hint="Blank turns the alert off.">
              <input value={threshold} onChange={(e) => setThreshold(e.target.value)} type="number" step="any" min="0" placeholder="off" className={`${inputCls} tabular`} />
            </Field>
          </div>

          {/* Per-SKU stocking — the key difference between e.g. universal tea bags and printed pouches. */}
          <div className="rounded-xl border border-border bg-surface-2/40 p-3">
            <label className={`flex items-start gap-2.5 ${locked ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                checked={skuSpecific}
                disabled={locked}
                onChange={(e) => setSkuSpecific(e.target.checked)}
                className="mt-0.5 accent-[#1a2f18]"
              />
              <span>
                <span className="text-[13px] font-medium text-ink">Stocked separately for each product (SKU-specific)</span>
                <span className="mt-0.5 block text-[11.5px] text-muted">
                  On: each product has its own stock of this material — like printed pouches, where every SKU has a different
                  design. You&apos;ll pick the product when buying it. Off: one shared pool used across all products — like plain
                  tea bags.
                </span>
              </span>
            </label>
            {locked && (
              <div className="mt-2 flex items-start gap-1.5 text-[11.5px] text-muted">
                <Lock size={13} className="mt-0.5 shrink-0" />
                <span>
                  This can&apos;t be changed now that the material has purchases or is used in production — switching it would
                  scramble its stock pools. To change it, create a new material.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      <SaveBar dirty={dirty} pending={pending} error={error} saved={saved} onSave={save} onReset={reset} />
    </Card>
  );
}
