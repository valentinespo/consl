"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X, AlertTriangle } from "@/components/icons";
import { DatePicker } from "@/components/DatePicker";
import { Field, inputCls } from "@/components/FormKit";
import { DESTINATIONS, RAW_DESTINATIONS, destinationLabel } from "@/lib/destinations";
import { createMovement } from "@/app/facilities/actions";

export type MoveProduct = { id: string; code: string; name: string };
export type MoveMaterial = { id: string; code: string; name: string; skuSpecific: boolean };
export type MoveFacility = { id: string; code: string; name: string };
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
  channels = [],
}: {
  products: MoveProduct[];
  materials: MoveMaterial[];
  facilities: MoveFacility[];
  onHand: OnHandRow[];
  todayISO: string;
  onDone: () => void;
  /** Connected channel roots (AMAZON | SHOPIFY | TIKTOK) stock can be pulled BACK from. */
  channels?: string[];
}) {
  const router = useRouter();
  // The item is picked as "FINISHED:<productId>" or "RAW:<materialId>".
  const firstItem = products[0] ? `FINISHED:${products[0].id}` : materials[0] ? `RAW:${materials[0].id}` : "";
  const [item, setItem] = useState(firstItem);
  const [poolSku, setPoolSku] = useState(""); // only for sku-specific raw materials
  // A facility id, or "channel:<ROOT>" when finished stock is coming back from a sales channel.
  const [source, setSource] = useState(facilities[0]?.id ?? "");
  const [target, setTarget] = useState<string>("AMAZON"); // "facility:<id>" = transfer, else a destination
  const [quantity, setQuantity] = useState("");
  const [dateISO, setDateISO] = useState(todayISO);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, itemId] = item.split(":") as ["FINISHED" | "RAW", string];
  const isRaw = kind === "RAW";
  const material = isRaw ? materials.find((m) => m.id === itemId) ?? null : null;
  const needsSku = isRaw && !!material?.skuSpecific;

  // Raw materials never sit at a channel — flip the source back to a facility if the kind changes.
  const channelFrom = !isRaw && source.startsWith("channel:") ? source.slice("channel:".length) : null;
  const fromFacilityId = source.startsWith("channel:") ? "" : source;

  // A raw material can only move to another facility or be written off — never to a channel/customer.
  // Stock leaving a channel can go anywhere except back to the same channel.
  const destinations = channelFrom ? DESTINATIONS.filter((d) => d.value !== channelFrom) : isRaw ? RAW_DESTINATIONS : DESTINATIONS;
  // Keep the target valid when the item kind or source flips.
  const validTarget = target.startsWith("facility:")
    ? target.slice("facility:".length) !== fromFacilityId
    : destinations.some((d) => d.value === target);
  const effectiveTarget = validTarget
    ? target
    : destinations[0]?.value ?? (facilities.find((f) => f.id !== fromFacilityId) ? `facility:${facilities.find((f) => f.id !== fromFacilityId)!.id}` : "");

  const available =
    onHand.find(
      (r) => r.kind === kind && r.itemId === itemId && r.facilityId === fromFacilityId && (!needsSku || r.poolSku === (poolSku || null)),
    )?.units ?? 0;
  const q = Math.round(Number(quantity) || 0);
  const short = !channelFrom && q > available;

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
        fromFacilityId: channelFrom ? null : fromFacilityId,
        fromDestination: channelFrom,
        toFacilityId: isTransfer ? effectiveTarget.slice("facility:".length) : null,
        toDestination: isTransfer ? null : effectiveTarget,
        notes,
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

  const canSave = q > 0 && !!itemId && (!needsSku || !!poolSku) && !!effectiveTarget && (!!channelFrom || !!fromFacilityId);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="What's moving?">
          <select
            value={item}
            onChange={(e) => {
              setItem(e.target.value);
              setPoolSku("");
              // Raw materials never come back from a channel — snap the source to a facility.
              if (e.target.value.startsWith("RAW:") && source.startsWith("channel:")) setSource(facilities[0]?.id ?? "");
            }}
            className={inputCls}
          >
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

        <Field
          label="Moving from"
          hint={
            channelFrom
              ? "The units re-enter at the cost they had when they went to the channel."
              : `${Math.round(available).toLocaleString()} on hand here`
          }
        >
          <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
            <optgroup label="Your facilities">
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} — {f.name}
                </option>
              ))}
            </optgroup>
            {!isRaw && channels.length > 0 && (
              <optgroup label="Back from a sales channel">
                {channels.map((c) => (
                  <option key={c} value={`channel:${c}`}>
                    {destinationLabel(c)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>

        <Field label="Moving to">
          <select value={effectiveTarget} onChange={(e) => setTarget(e.target.value)} className={inputCls}>
            {destinations.length > 0 && (
              <optgroup label={channelFrom ? "To another channel / out of inventory" : isRaw ? "Out of inventory" : "Out of your network"}>
                {destinations.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={channelFrom ? "Into one of your facilities" : "Transfer to another facility"}>
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
  channels = [],
}: {
  products: MoveProduct[];
  materials: MoveMaterial[];
  facilities: MoveFacility[];
  onHand: OnHandRow[];
  todayISO: string;
  channels?: string[];
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
      <MovementForm products={products} materials={materials} facilities={facilities} onHand={onHand} todayISO={todayISO} channels={channels} onDone={() => setOpen(false)} />
    </div>
  );
}
