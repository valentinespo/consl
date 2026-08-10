"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { Field, SaveBar, inputCls } from "@/components/FormKit";
import { saveRestockDefaults } from "@/app/settings/actions";
import { BATCH_HELP, BUFFER_HELP, FLOOR_HELP, LEAD_HELP, REORDER_TO_HELP, SHIP_HELP } from "@/lib/restock-help";

export type RestockDefaults = {
  defaultMinMonths: number;
  defaultLeadMonths: number;
  shipDays: number;
  shipBufferX: number;
  defaultReorderTo: number;
  defaultBatchSize: number;
};

export function RestockSettings({ initial }: { initial: RestockDefaults }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const set = <K extends keyof RestockDefaults>(k: K, v: RestockDefaults[K]) => {
    setS((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };

  const dirty =
    s.defaultMinMonths !== initial.defaultMinMonths ||
    s.defaultLeadMonths !== initial.defaultLeadMonths ||
    s.shipDays !== initial.shipDays ||
    s.shipBufferX !== initial.shipBufferX ||
    s.defaultReorderTo !== initial.defaultReorderTo ||
    s.defaultBatchSize !== initial.defaultBatchSize;

  function save() {
    setError(null);
    startSave(async () => {
      const r = await saveRestockDefaults(s);
      if (r.ok) setSaved(true);
      else setError(r.error);
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <div className="mb-4">
          <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Restock defaults</div>
          <p className="mt-1.5 max-w-[62ch] text-[12.5px] text-muted">
            How much cover you want to hold, how long stock takes to make and to move, and how big a
            production run is. Used for every product that doesn&apos;t have its own override on the
            Inventory page.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Floor (months)" hint="Reorder once cover drops below this." help={FLOOR_HELP}>
            <input
              type="number"
              step={0.5}
              min={0}
              value={s.defaultMinMonths}
              onChange={(e) => set("defaultMinMonths", Number(e.target.value))}
              className={`${inputCls} tabular`}
            />
          </Field>
          <Field label="Lead time (months)" hint="Placing a run to sellable stock." help={LEAD_HELP}>
            <input
              type="number"
              step={0.5}
              min={0}
              value={s.defaultLeadMonths}
              onChange={(e) => set("defaultLeadMonths", Number(e.target.value))}
              className={`${inputCls} tabular`}
            />
          </Field>
          <Field label="Shipping time (days)" hint="Your warehouse to the channel." help={SHIP_HELP}>
            <input
              type="number"
              step={1}
              min={0}
              value={s.shipDays}
              onChange={(e) => set("shipDays", Number(e.target.value))}
              className={`${inputCls} tabular`}
            />
          </Field>
          <Field
            label="Shipping buffer (×)"
            hint={`Start shipping under ${Math.round(s.shipDays * s.shipBufferX)} days of cover.`}
            help={BUFFER_HELP}
          >
            <input
              type="number"
              step={0.5}
              min={0}
              value={s.shipBufferX}
              onChange={(e) => set("shipBufferX", Number(e.target.value))}
              className={`${inputCls} tabular`}
            />
          </Field>
          <Field label="Order size (months)" hint="Months of sales per production run." help={REORDER_TO_HELP}>
            <input
              type="number"
              step={0.5}
              min={0.5}
              value={s.defaultReorderTo}
              onChange={(e) => set("defaultReorderTo", Number(e.target.value))}
              className={`${inputCls} tabular`}
            />
          </Field>
          <Field label="Batch size (units)" hint="0 = order any quantity." help={BATCH_HELP}>
            <input
              type="number"
              step={1}
              min={0}
              value={s.defaultBatchSize}
              onChange={(e) => set("defaultBatchSize", Number(e.target.value))}
              className={`${inputCls} tabular`}
            />
          </Field>
        </div>
      </Card>

      <SaveBar
        dirty={dirty}
        pending={saving}
        error={error}
        saved={saved}
        onSave={save}
        onReset={() => {
          setS(initial);
          setError(null);
        }}
      />
    </>
  );
}
