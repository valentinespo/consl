"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X, AlertTriangle, ArrowOutbound, ArrowInbound } from "@/components/icons";
import { DatePicker } from "@/components/DatePicker";
import { Field, inputCls } from "@/components/FormKit";
import { DESTINATIONS, RAW_DESTINATIONS } from "@/lib/destinations";
import { createMovement } from "@/app/facilities/actions";

export type MoveProduct = { id: string; code: string; name: string };
export type MoveMaterial = { id: string; code: string; name: string; skuSpecific: boolean };
export type MoveFacility = { id: string; code: string; name: string };
/** A connected channel's locked facility — an inflow source ("Shopify — 638 Alton Place"). */
export type MoveChannelFacility = { id: string; name: string; channel: string };
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

/** AMAZON_FBA / AMAZON_AWD collapse into the AMAZON pool; Shopify/TikTok tags are their own root. */
const rootOf = (channel: string) => (channel.startsWith("AMAZON") ? "AMAZON" : channel);
const ROOT_LABEL: Record<string, string> = { AMAZON: "Amazon", SHOPIFY: "Shopify", TIKTOK: "TikTok Shop" };

/** "Amazon — FBA (Removal order)", "Shopify — 638 Alton Place" — the provider, then the specific
 *  place. FBA is annotated because a removal order is the only way stock ever leaves it back to you. */
function channelOptionLabel(f: MoveChannelFacility): string {
  const provider = ROOT_LABEL[rootOf(f.channel)] ?? rootOf(f.channel);
  const place = f.name.replace(new RegExp(`^${provider}\\s+`, "i"), "");
  const suffix = f.channel === "AMAZON_FBA" ? " (Removal order)" : "";
  return `${provider} — ${place}${suffix}`;
}

export function MovementForm({
  products,
  materials,
  facilities,
  onHand,
  todayISO,
  onDone,
  channelFacilities = [],
}: {
  products: MoveProduct[];
  materials: MoveMaterial[];
  facilities: MoveFacility[];
  onHand: OnHandRow[];
  todayISO: string;
  onDone: () => void;
  /** Connected channels' locked facilities — the places finished stock can be pulled back from. */
  channelFacilities?: MoveChannelFacility[];
}) {
  const router = useRouter();
  // Inflow needs a channel to pull from and a product to pull — otherwise only outflow exists.
  const canInflow = channelFacilities.length > 0 && products.length > 0 && facilities.length > 0;
  const [mode, setMode] = useState<"OUT" | "IN" | null>(null);

  // The item is picked as "FINISHED:<productId>" or "RAW:<materialId>".
  const firstItem = products[0] ? `FINISHED:${products[0].id}` : materials[0] ? `RAW:${materials[0].id}` : "";
  const [item, setItem] = useState(firstItem);
  const [poolSku, setPoolSku] = useState(""); // only for sku-specific raw materials
  // OUT: a facility id. IN: "channel:<ROOT>:<facilityId>" — the specific place at the channel.
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [quantity, setQuantity] = useState("");
  const [dateISO, setDateISO] = useState(todayISO);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, itemId] = item.split(":") as ["FINISHED" | "RAW", string];
  const isRaw = kind === "RAW";
  const material = isRaw ? materials.find((m) => m.id === itemId) ?? null : null;
  const needsSku = isRaw && !!material?.skuSpecific;

  const channelSource = mode === "IN" && source.startsWith("channel:") ? source.split(":") : null;
  const fromRoot = channelSource ? channelSource[1] : null; // AMAZON | SHOPIFY | TIKTOK
  const fromChannelFacilityId = channelSource ? channelSource[2] : null;
  const fromFacilityId = mode === "OUT" ? source : "";

  // What the target select offers, per mode. Outflow: out of the network + transfers.
  // Inflow: into a facility, or over to another channel — never customer/loss (a channel's own
  // count already handles stock that's sold or gone; there's nothing to record).
  const destinations = useMemo(() => {
    if (mode === "IN") {
      const roots = [...new Set(channelFacilities.map((f) => rootOf(f.channel)))].filter((r) => r !== fromRoot);
      return roots.map((r) => ({ value: r, label: `${ROOT_LABEL[r] ?? r} (channel stock)` }));
    }
    return (isRaw ? RAW_DESTINATIONS : DESTINATIONS).map((d) => ({ value: d.value, label: d.label }));
  }, [mode, isRaw, channelFacilities, fromRoot]);

  const targetFacilities = facilities.filter((f) => f.id !== fromFacilityId);
  const validTarget = target.startsWith("facility:")
    ? targetFacilities.some((f) => `facility:${f.id}` === target)
    : destinations.some((d) => d.value === target);
  const effectiveTarget = validTarget
    ? target
    : mode === "IN"
      ? targetFacilities[0]
        ? `facility:${targetFacilities[0].id}`
        : ""
      : destinations[0]?.value ?? (targetFacilities[0] ? `facility:${targetFacilities[0].id}` : "");

  const available =
    onHand.find(
      (r) => r.kind === kind && r.itemId === itemId && r.facilityId === fromFacilityId && (!needsSku || r.poolSku === (poolSku || null)),
    )?.units ?? 0;
  const q = Math.round(Number(quantity) || 0);
  const short = mode === "OUT" && q > available;

  const skuOptions = useMemo(() => {
    if (!needsSku) return [] as { id: string; code: string }[];
    const seen = new Map<string, string>();
    for (const r of onHand) {
      if (r.kind === "RAW" && r.itemId === itemId && r.poolSku) seen.set(r.poolSku, r.poolSkuCode ?? r.poolSku);
    }
    return [...seen].map(([id, code]) => ({ id, code }));
  }, [needsSku, onHand, itemId]);

  function pickMode(next: "OUT" | "IN") {
    setMode(next);
    setError(null);
    if (next === "OUT") {
      setItem(firstItem);
      setSource(facilities[0]?.id ?? "");
      setTarget("");
    } else {
      setItem(products[0] ? `FINISHED:${products[0].id}` : "");
      const f = channelFacilities[0];
      setSource(f ? `channel:${rootOf(f.channel)}:${f.id}` : "");
      setTarget(facilities[0] ? `facility:${facilities[0].id}` : "");
    }
    setPoolSku("");
  }

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
        fromFacilityId: mode === "IN" ? fromChannelFacilityId : fromFacilityId,
        fromDestination: fromRoot,
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

  const canSave =
    !!mode && q > 0 && !!itemId && (!needsSku || !!poolSku) && !!effectiveTarget && (mode === "IN" ? !!fromRoot : !!fromFacilityId);

  const modeBtn = (active: boolean, disabled = false) =>
    `flex flex-1 items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
      active ? "border-accent-strong bg-accent-soft/60" : "border-border bg-surface hover:border-accent-strong/50"
    } ${disabled ? "cursor-not-allowed opacity-45 hover:border-border" : ""}`;

  return (
    <div className="space-y-3">
      {/* What kind of movement is this? Nothing else shows until they choose. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => pickMode("OUT")} className={modeBtn(mode === "OUT")}>
          <span className={`mt-0.5 shrink-0 ${mode === "OUT" ? "text-accent" : "text-muted"}`}>
            <ArrowOutbound size={20} />
          </span>
          <span>
            <span className="block text-[13px] font-semibold text-ink">Outflow — send stock out</span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">
              From one of your facilities to another one, a sales channel, a customer, or a write-off.
            </span>
          </span>
        </button>
        <button type="button" onClick={() => canInflow && pickMode("IN")} className={modeBtn(mode === "IN", !canInflow)} disabled={!canInflow}>
          <span className={`mt-0.5 shrink-0 ${mode === "IN" ? "text-accent" : "text-muted"}`}>
            <ArrowInbound size={20} />
          </span>
          <span>
            <span className="block text-[13px] font-semibold text-ink">Inflow — bring stock back</span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">
              {canInflow
                ? "From a sales channel into one of your facilities, or over to another channel. Cost carries over automatically."
                : "Needs a connected sales channel holding your products."}
            </span>
          </span>
        </button>
      </div>

      {mode && (
        <>
          <div className="sm:max-w-[220px]">
            <Field label="Date">
              <DatePicker value={dateISO} onChange={setDateISO} />
            </Field>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <Field label="What's moving?">
                <select
                  value={item}
                  onChange={(e) => {
                    setItem(e.target.value);
                    setPoolSku("");
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
                  {mode === "OUT" && materials.length > 0 && (
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
            </div>

            {needsSku && (
              <div className="min-w-[160px]">
                <Field label="For which product?" hint="Stocked separately per product.">
                  <select value={poolSku} onChange={(e) => setPoolSku(e.target.value)} className={inputCls}>
                    <option value="">Select…</option>
                    {skuOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}

            <Field label="Units">
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
                className={`${inputCls} tabular max-w-28 text-right`}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={
                <span className="flex items-center gap-1.5">
                  <ArrowOutbound size={14} className="text-muted" /> Moving from
                </span>
              }
              hint={
                mode === "IN"
                  ? "The units re-enter at the cost they had when they went to the channel."
                  : `${Math.round(available).toLocaleString()} on hand here`
              }
            >
              <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
                {mode === "OUT" ? (
                  facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.code} — {f.name}
                    </option>
                  ))
                ) : (
                  channelFacilities.map((f) => (
                    <option key={f.id} value={`channel:${rootOf(f.channel)}:${f.id}`}>
                      {channelOptionLabel(f)}
                    </option>
                  ))
                )}
              </select>
            </Field>

            <Field
              label={
                <span className="flex items-center gap-1.5">
                  <ArrowInbound size={14} className="text-muted" /> Moving to
                </span>
              }
            >
              <select value={effectiveTarget} onChange={(e) => setTarget(e.target.value)} className={inputCls}>
                {mode === "IN" ? (
                  <>
                    <optgroup label="Into one of your facilities">
                      {targetFacilities.map((f) => (
                        <option key={f.id} value={`facility:${f.id}`}>
                          {f.code} — {f.name}
                        </option>
                      ))}
                    </optgroup>
                    {destinations.length > 0 && (
                      <optgroup label="Over to another channel">
                        {destinations.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </>
                ) : (
                  <>
                    <optgroup label={isRaw ? "Out of inventory" : "Out of your network"}>
                      {destinations.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Transfer to another facility">
                      {targetFacilities.map((f) => (
                        <option key={f.id} value={`facility:${f.id}`}>
                          {f.code} — {f.name}
                        </option>
                      ))}
                    </optgroup>
                  </>
                )}
              </select>
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
        </>
      )}
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
  channelFacilities = [],
}: {
  products: MoveProduct[];
  materials: MoveMaterial[];
  facilities: MoveFacility[];
  onHand: OnHandRow[];
  todayISO: string;
  channelFacilities?: MoveChannelFacility[];
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
      <MovementForm
        products={products}
        materials={materials}
        facilities={facilities}
        onHand={onHand}
        todayISO={todayISO}
        channelFacilities={channelFacilities}
        onDone={() => setOpen(false)}
      />
    </div>
  );
}
