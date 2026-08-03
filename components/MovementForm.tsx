"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X, AlertTriangle } from "@/components/icons";
import { DatePicker } from "@/components/DatePicker";
import { Field, inputCls } from "@/components/FormKit";
import { DESTINATIONS, RAW_DESTINATIONS } from "@/lib/destinations";
import { createMovement } from "@/app/facilities/actions";

export type MoveProduct = { id: string; code: string; name: string };
export type MoveMaterial = { id: string; code: string; name: string; skuSpecific: boolean };
export type MoveFacility = { id: string; code: string; name: string };
/** A live platform shipment a to-Amazon movement can attach to (reconciliation attribution). */
export type MoveShipment = { id: string; label: string; productIds: string[] };
// On-hand keyed loosely: finished uses productId+facility; raw uses materialId(+poolSku)+facility.
// poolSku is the product ID (matches what the action stores); poolSkuCode is for display.
export type OnHandRow = {
  kind: "FINISHED" | "RAW";
  itemId: string;
  poolSku: string | null;
  poolSkuCode: string | null;
  facilityId: string;
  units: number;
};

export function MovementForm({
  products,
  materials,
  facilities,
  onHand,
  todayISO,
  onDone,
  openShipments = [],
}: {
  products: MoveProduct[];
  materials: MoveMaterial[];
  facilities: MoveFacility[];
  onHand: OnHandRow[];
  todayISO: string;
  onDone: () => void;
  openShipments?: MoveShipment[];
}) {
  const router = useRouter();
  // The item is picked as "FINISHED:<productId>" or "RAW:<materialId>".
  const firstItem = products[0] ? `FINISHED:${products[0].id}` : materials[0] ? `RAW:${materials[0].id}` : "";
  const [item, setItem] = useState(firstItem);
  const [poolSku, setPoolSku] = useState(""); // only for sku-specific raw materials
  const [fromFacilityId, setFromFacilityId] = useState(facilities[0]?.id ?? "");
  const [target, setTarget] = useState<string>("AMAZON"); // "facility:<id>" = transfer, else a destination
  const [quantity, setQuantity] = useState("");
  const [dateISO, setDateISO] = useState(todayISO);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, itemId] = item.split(":") as ["FINISHED" | "RAW", string];
  const isRaw = kind === "RAW";
  // A to-Amazon finished movement can attach to a live shipment; default to the single match.
  const matchingShipments = !isRaw ? openShipments.filter((s) => s.productIds.includes(itemId)) : [];
  const [shipmentId, setShipmentId] = useState<string>("");
  const effectiveShipmentId =
    shipmentId === "none" ? "" : shipmentId || (matchingShipments.length === 1 ? matchingShipments[0].id : "");
  const material = isRaw ? materials.find((m) => m.id === itemId) ?? null : null;
  const needsSku = isRaw && !!material?.skuSpecific;

  // A raw material can only move to another facility or be written off — never to a channel/customer.
  const destinations = isRaw ? RAW_DESTINATIONS : DESTINATIONS;
  // Keep the target valid when the item kind flips.
  const validTarget = target.startsWith("facility:") || destinations.some((d) => d.value === target);
  const effectiveTarget = validTarget ? target : destinations[0]?.value ?? "";

  const available =
    onHand.find(
      (r) => r.kind === kind && r.itemId === itemId && r.facilityId === fromFacilityId && (!needsSku || r.poolSku === (poolSku || null)),
    )?.units ?? 0;
  const q = Math.round(Number(quantity) || 0);
  const short = q > available;

  const skuOptions = useMemo(() => {
    if (!needsSku) return [] as { id: string; code: string }[];
    const seen = new Map<string, string>();
    for (const r of onHand) {
      if (r.kind === "RAW" && r.itemId === itemId && r.poolSku) seen.set(r.poolSku, r.poolSkuCode ?? r.poolSku);
    }
    return [...seen].map(([id, code]) => ({ id, code }));
  }, [needsSku, onHand, itemId]);

  async function save() {
    setError(null);
    setPending(true);
    const isTransfer = effectiveTarget.startsWith("facility:");
    try {
      const res = await createMovement({
        itemType: kind,
        productId: isRaw ? (needsSku ? poolSku || null : null) : itemId,
        materialTypeId: isRaw ? itemId : null,
        quantity: q,
        dateISO,
        fromFacilityId,
        toFacilityId: isTransfer ? effectiveTarget.slice("facility:".length) : null,
        toDestination: isTransfer ? null : effectiveTarget,
        notes,
        shipmentId: !isTransfer && effectiveTarget === "AMAZON" ? effectiveShipmentId || null : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
      router.refresh();
    } catch {
      setError("Couldn't reach the server — reload to check whether it recorded.");
    } finally {
      setPending(false);
    }
  }

  const canSave = q > 0 && !!fromFacilityId && !!itemId && (!needsSku || !!poolSku);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="What's moving?">
          <select value={item} onChange={(e) => { setItem(e.target.value); setPoolSku(""); }} className={inputCls}>
            {products.length > 0 && (
              <optgroup label="Finished products">
                {products.map((p) => (
                  <option key={p.id} value={`FINISHED:${p.id}`}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </optgroup>
            )}
            {materials.length > 0 && (
              <optgroup label="Raw materials">
                {materials.map((m) => (
                  <option key={m.id} value={`RAW:${m.id}`}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>

        {needsSku && (
          <Field label="For which product?" hint="This material is stocked separately per product.">
            <select value={poolSku} onChange={(e) => setPoolSku(e.target.value)} className={inputCls}>
              <option value="">Select…</option>
              {skuOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Moving from" hint={`${Math.round(available).toLocaleString()} on hand here`}>
          <select value={fromFacilityId} onChange={(e) => setFromFacilityId(e.target.value)} className={inputCls}>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} — {f.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Moving to">
          <select value={effectiveTarget} onChange={(e) => setTarget(e.target.value)} className={inputCls}>
            <optgroup label={isRaw ? "Out of inventory" : "Out of your network"}>
              {destinations.map((d) => (
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
          <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" className={`${inputCls} tabular text-right`} />
        </Field>

        {effectiveTarget === "AMAZON" && matchingShipments.length > 0 && (
          <Field label="Amazon shipment" hint="Ties this movement to the real inbound shipment.">
            <select value={effectiveShipmentId || "none"} onChange={(e) => setShipmentId(e.target.value)} className={inputCls}>
              <option value="none">Not on a listed shipment</option>
              {matchingShipments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Date">
          <DatePicker value={dateISO} onChange={setDateISO} />
        </Field>
      </div>

      <Field label="Note" hint="Optional — e.g. a shipment or reference number.">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Reference / note" />
      </Field>

      {short && q > 0 && (
        <div className="flex items-start gap-1.5 rounded-lg border border-[#f0d3cb] bg-[#fdf2ef] px-3 py-2 text-[12.5px] text-negative">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            That location only shows {Math.round(available).toLocaleString()} on hand. You can still record this — it&apos;ll be
            flagged as short until an earlier movement, lot or purchase is corrected.
          </span>
        </div>
      )}
      {error && <div className="rounded-lg border border-[#f0d3cb] bg-[#fdf2ef] px-3 py-2 text-[12.5px] text-negative">{error}</div>}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onDone} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={pending || !canSave}
          className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
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
  materials,
  facilities,
  onHand,
  todayISO,
  openShipments = [],
}: {
  products: MoveProduct[];
  materials: MoveMaterial[];
  facilities: MoveFacility[];
  onHand: OnHandRow[];
  todayISO: string;
  openShipments?: MoveShipment[];
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90"
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
      <MovementForm products={products} materials={materials} facilities={facilities} onHand={onHand} todayISO={todayISO} onDone={() => setOpen(false)} openShipments={openShipments} />
    </div>
  );
}
