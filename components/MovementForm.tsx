"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Field, inputCls } from "@/components/FormKit";
import { DESTINATIONS } from "@/lib/destinations";
import { createMovement } from "@/app/facilities/actions";

export type MoveProduct = { id: string; code: string; name: string };
export type MoveFacility = { id: string; code: string; name: string };
export type OnHandRow = { productId: string; facilityId: string; units: number };

export function MovementForm({
  products,
  facilities,
  onHand,
  todayISO,
  onDone,
}: {
  products: MoveProduct[];
  facilities: MoveFacility[];
  onHand: OnHandRow[];
  todayISO: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [fromFacilityId, setFromFacilityId] = useState(facilities[0]?.id ?? "");
  // "" = pick one; "facility:<id>" = transfer; otherwise a destination key.
  const [target, setTarget] = useState<string>("AMAZON");
  const [quantity, setQuantity] = useState("");
  const [dateISO, setDateISO] = useState(todayISO);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = onHand.find((r) => r.productId === productId && r.facilityId === fromFacilityId)?.units ?? 0;
  const qty = Math.round(Number(quantity) || 0);
  const short = qty > available;

  async function save() {
    setError(null);
    setPending(true);
    const isTransfer = target.startsWith("facility:");
    const res = await createMovement({
      productId,
      quantity: qty,
      dateISO,
      fromFacilityId,
      toFacilityId: isTransfer ? target.slice("facility:".length) : null,
      toDestination: isTransfer ? null : target,
      notes,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDone();
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Product">
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Moving from" hint={`${Math.round(available).toLocaleString()} units on hand here`}>
          <select value={fromFacilityId} onChange={(e) => setFromFacilityId(e.target.value)} className={inputCls}>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} — {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Moving to">
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputCls}>
            <optgroup label="Out of your network">
              {DESTINATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Transfer to another facility">
              {facilities
                .filter((f) => f.id !== fromFacilityId)
                .map((f) => (
                  <option key={f.id} value={`facility:${f.id}`}>
                    {f.code} — {f.name}
                  </option>
                ))}
            </optgroup>
          </select>
        </Field>
        <Field label="Units">
          <input
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0"
            className={`${inputCls} tabular text-right`}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <Field label="Date">
          <input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Note" hint="Optional — e.g. a shipment or reference number.">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Reference / note" />
        </Field>
      </div>

      {short && qty > 0 && (
        <div className="rounded-lg border border-[#f0d3cb] bg-[#fdf2ef] px-3 py-2 text-[12.5px] text-negative">
          ⚠ That location only shows {Math.round(available).toLocaleString()} units on hand. You can still record this —
          it&apos;ll be flagged as short until an earlier movement or lot is corrected.
        </div>
      )}
      {error && <div className="rounded-lg border border-[#f0d3cb] bg-[#fdf2ef] px-3 py-2 text-[12.5px] text-negative">{error}</div>}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onDone} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={pending || qty <= 0 || !productId || !fromFacilityId}
          className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Record movement"}
        </button>
      </div>
    </div>
  );
}

/** Wraps the form in a collapsible "Record movement" panel. */
export function NewMovementPanel({
  products,
  facilities,
  onHand,
  todayISO,
}: {
  products: MoveProduct[];
  facilities: MoveFacility[];
  onHand: OnHandRow[];
  todayISO: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90"
      >
        Record movement
      </button>
    );
  }
  return (
    <div className="mb-4 w-full rounded-[var(--radius-card)] border border-accent-strong bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-ink-soft">Record a stock movement</span>
        <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
          <X size={18} />
        </button>
      </div>
      <MovementForm products={products} facilities={facilities} onHand={onHand} todayISO={todayISO} onDone={() => setOpen(false)} />
    </div>
  );
}
