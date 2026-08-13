"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X, AlertTriangle, ArrowOutbound, ArrowInbound, Warehouse, Package, Search, Undo2, User, Trash2 } from "@/components/icons";
import { DatePicker } from "@/components/DatePicker";
import { Field, inputCls } from "@/components/FormKit";
import { IconSelect, type IconGroup } from "@/components/IconSelect";
import { SkuAvatar } from "@/components/ui";
import { CHANNEL_LOGO, ROOT_LOGO } from "@/lib/channel-logos";
import { buildTimeline, capOn, type AvailabilityEvent } from "@/lib/availability-math";
import { createMovement } from "@/app/facilities/actions";

export type MoveProduct = { id: string; code: string; name: string; imageUrl: string | null };
export type MoveMaterial = { id: string; code: string; name: string; skuSpecific: boolean; imageUrl: string | null };
export type MoveFacility = { id: string; code: string; name: string };
/** A connected channel's locked facility — an inflow source ("Shopify — 638 Alton Place"). */
export type MoveChannelFacility = { id: string; name: string; channel: string };
/** Prefill for the adjustment cost field: newest known cost per product / material. */
export type CostHints = { products: Record<string, number>; materials: Record<string, number> };
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

/** A platform mark on a white tile (the logos are supplied on white). */
function LogoTile({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <span className="grid h-5 w-5 place-items-center rounded bg-white p-0.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="max-h-full max-w-full object-contain" />
    </span>
  );
}

function MaterialMark({ imageUrl }: { imageUrl: string | null }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" className="h-5 w-5 rounded border border-border object-cover" />;
  }
  return (
    <span className="grid h-5 w-5 place-items-center rounded border border-border bg-surface-2 text-muted">
      <Package size={12} />
    </span>
  );
}

export function MovementForm({
  products,
  materials,
  facilities,
  onHand,
  todayISO,
  onDone,
  channelFacilities = [],
  costHints = { products: {}, materials: {} },
  availability = [],
}: {
  products: MoveProduct[];
  materials: MoveMaterial[];
  facilities: MoveFacility[];
  onHand: OnHandRow[];
  todayISO: string;
  onDone: () => void;
  /** Connected channels' locked facilities — the places finished stock can be pulled back from. */
  channelFacilities?: MoveChannelFacility[];
  costHints?: CostHints;
  /** Dated stock changes per item × facility — drives the locked calendar and per-date caps. */
  availability?: AvailabilityEvent[];
}) {
  const router = useRouter();
  const canInflow = facilities.length > 0 && (products.length > 0 || materials.length > 0);
  const [mode, setMode] = useState<"OUT" | "IN" | null>(null);

  // The item is picked as "FINISHED:<productId>" or "RAW:<materialId>".
  const firstItem = products[0] ? `FINISHED:${products[0].id}` : materials[0] ? `RAW:${materials[0].id}` : "";
  const [item, setItem] = useState(firstItem);
  const [poolSku, setPoolSku] = useState(""); // only for sku-specific raw materials
  // OUT: a facility id. IN: "channel:<ROOT>:<facilityId>" or "adj:FOUND" / "adj:RETURN".
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState(""); // adjustments only — what one unit cost
  const [dateISO, setDateISO] = useState(todayISO);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, itemId] = item.split(":") as ["FINISHED" | "RAW", string];
  const isRaw = kind === "RAW";
  const material = isRaw ? materials.find((m) => m.id === itemId) ?? null : null;
  const needsSku = isRaw && !!material?.skuSpecific;

  const adjReason = source === "adj:FOUND" ? "FOUND" : source === "adj:RETURN" ? "RETURN" : null;
  const channelSource = mode === "IN" && source.startsWith("channel:") ? source.split(":") : null;
  const fromRoot = channelSource ? channelSource[1] : null; // AMAZON | SHOPIFY | TIKTOK
  const fromChannelFacilityId = channelSource ? channelSource[2] : null;
  const fromFacilityId = mode === "OUT" ? source : "";

  const connectedRoots = useMemo(() => [...new Set(channelFacilities.map((f) => rootOf(f.channel)))], [channelFacilities]);

  // Prefill the adjustment cost with the newest cost we know for the picked item, still editable.
  useEffect(() => {
    if (!adjReason) return;
    const hint = isRaw ? costHints.materials[itemId] : costHints.products[itemId];
    setUnitCost(hint != null ? String(Math.round(hint * 10000) / 10000) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjReason, item]);

  /* ------------------------------- option groups ------------------------------- */

  // Outflows can only move what the source facility actually holds — anything with no stock
  // there simply isn't offered. Inflows list everything (stock is arriving, not leaving).
  const hasStockAt = (k: "FINISHED" | "RAW", id: string, facilityId: string) =>
    onHand.some((r) => r.kind === k && r.itemId === id && r.facilityId === facilityId && r.units > 1e-9);
  const pickableProducts = mode === "OUT" ? products.filter((p) => hasStockAt("FINISHED", p.id, fromFacilityId)) : products;
  const pickableMaterials = mode === "OUT" ? materials.filter((m) => hasStockAt("RAW", m.id, fromFacilityId)) : materials;

  const productOptions = pickableProducts.map((p) => ({
    value: `FINISHED:${p.id}`,
    label: `${p.code} — ${p.name}`,
    icon: <SkuAvatar code={p.code} size={20} imageUrl={p.imageUrl} />,
  }));
  const materialOptions = pickableMaterials.map((m) => ({
    value: `RAW:${m.id}`,
    label: m.name,
    icon: <MaterialMark imageUrl={m.imageUrl} />,
  }));
  const itemGroups: IconGroup[] =
    mode === "IN" && adjReason !== "FOUND"
      ? [{ label: "Finished products", options: productOptions }]
      : [
          { label: "Finished products", options: productOptions },
          { label: "Raw materials", options: materialOptions },
        ];
  const nothingToMove = mode === "OUT" && productOptions.length === 0 && materialOptions.length === 0;

  // Keep the picked item valid when the source facility changes underneath it.
  useEffect(() => {
    if (mode !== "OUT") return;
    const stillValid =
      (kind === "FINISHED" && pickableProducts.some((p) => p.id === itemId)) ||
      (kind === "RAW" && pickableMaterials.some((m) => m.id === itemId));
    if (!stillValid) {
      setItem(pickableProducts[0] ? `FINISHED:${pickableProducts[0].id}` : pickableMaterials[0] ? `RAW:${pickableMaterials[0].id}` : "");
      setPoolSku("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, fromFacilityId]);

  const facilityOption = (f: MoveFacility, prefix = "") => ({
    value: `${prefix}${f.id}`,
    label: `${f.code} — ${f.name}`,
    icon: <Warehouse size={16} className="text-muted" />,
  });

  const sourceGroups: IconGroup[] =
    mode === "OUT"
      ? [{ label: "Your facilities", options: facilities.map((f) => facilityOption(f)) }]
      : [
          {
            label: "Back from a sales channel",
            options: channelFacilities.map((f) => ({
              value: `channel:${rootOf(f.channel)}:${f.id}`,
              label: channelOptionLabel(f),
              icon: <LogoTile src={CHANNEL_LOGO[f.channel] ?? ROOT_LOGO[rootOf(f.channel)]} />,
            })),
          },
          {
            label: "Stock appearing",
            options: [
              { value: "adj:FOUND", label: "Found stock / correction", icon: <Search size={16} className="text-muted" /> },
              { value: "adj:RETURN", label: "Customer return", icon: <Undo2 size={16} className="text-muted" /> },
            ],
          },
        ];

  const targetFacilities = facilities.filter((f) => f.id !== fromFacilityId);
  const targetGroups: IconGroup[] = useMemo(() => {
    if (mode === "IN") {
      const groups: IconGroup[] = [{ label: "Into one of your facilities", options: targetFacilities.map((f) => facilityOption(f, "facility:")) }];
      if (fromRoot) {
        const others = connectedRoots.filter((r) => r !== fromRoot);
        if (others.length > 0) {
          groups.push({
            label: "Over to another channel",
            options: others.map((r) => ({ value: r, label: `${ROOT_LABEL[r] ?? r} (channel stock)`, icon: <LogoTile src={ROOT_LOGO[r]} /> })),
          });
        }
      }
      return groups;
    }
    // Outflow: only channels that are actually connected, plus customer / write-off, plus transfers.
    const channelDests = isRaw
      ? []
      : connectedRoots.map((r) => ({ value: r, label: `${ROOT_LABEL[r] ?? r} (channel stock)`, icon: <LogoTile src={ROOT_LOGO[r]} /> }));
    const out = [
      ...channelDests,
      ...(isRaw
        ? []
        : [{ value: "CUSTOMER", label: "Sold / shipped to customer", icon: <User size={16} className="text-muted" /> }]),
      { value: "LOSS", label: "Lost / damaged (write-off)", icon: <Trash2 size={16} className="text-muted" /> },
    ];
    return [
      { label: isRaw ? "Out of inventory" : "Out of your network", options: out },
      { label: "Transfer to another facility", options: targetFacilities.map((f) => facilityOption(f, "facility:")) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isRaw, fromRoot, connectedRoots, facilities, fromFacilityId, adjReason]);

  const flatTargets = targetGroups.flatMap((g) => g.options);
  const effectiveTarget = flatTargets.some((o) => o.value === target) ? target : flatTargets[0]?.value ?? "";

  const available =
    onHand.find(
      (r) => r.kind === kind && r.itemId === itemId && r.facilityId === fromFacilityId && (!needsSku || r.poolSku === (poolSku || null)),
    )?.units ?? 0;
  const q = Math.round(Number(quantity) || 0);

  // What was here through time for the chosen item at the chosen source — locks the calendar to
  // days the stock actually existed, and caps the units for whatever date is picked. The cap for
  // a date also respects movements already recorded AFTER it, so backdating can never take units
  // a later shipment already carried away.
  const comboReady = mode === "OUT" && !!fromFacilityId && !!itemId && (!needsSku || !!poolSku);
  const timeline = useMemo(
    () =>
      !comboReady
        ? []
        : buildTimeline(
            availability.filter(
              (e) =>
                e.kind === kind &&
                e.itemId === itemId &&
                e.facilityId === fromFacilityId &&
                (e.poolSku ?? null) === (needsSku ? poolSku || null : null),
            ),
          ),
    [comboReady, availability, kind, itemId, fromFacilityId, needsSku, poolSku],
  );
  const dateCap = comboReady ? capOn(timeline, dateISO) : Infinity;
  const overCap = comboReady && q > dateCap + 1e-9;

  // A combo switch can leave the picked date on a day that had nothing — snap back to today.
  useEffect(() => {
    if (comboReady && dateISO !== todayISO && capOn(timeline, dateISO) <= 1e-9) setDateISO(todayISO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comboReady, timeline]);

  // Pool-SKU options: pools with stock at the source when stock is moving; ANY product when
  // stock is appearing (a found box of pouches may be for a SKU with no recorded stock yet).
  const skuOptions = useMemo(() => {
    if (!needsSku) return [] as { id: string; code: string }[];
    if (adjReason) return products.map((p) => ({ id: p.id, code: p.code }));
    const seen = new Map<string, string>();
    for (const r of onHand) {
      if (r.kind === "RAW" && r.itemId === itemId && r.poolSku && r.facilityId === fromFacilityId && r.units > 1e-9) {
        seen.set(r.poolSku, r.poolSkuCode ?? r.poolSku);
      }
    }
    return [...seen].map(([id, code]) => ({ id, code }));
  }, [needsSku, adjReason, products, onHand, itemId, fromFacilityId]);

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
      setSource(f ? `channel:${rootOf(f.channel)}:${f.id}` : "adj:FOUND");
      setTarget(facilities[0] ? `facility:${facilities[0].id}` : "");
    }
    setPoolSku("");
  }

  function pickSource(next: string) {
    setSource(next);
    // A customer return (or a channel pull-back) can only be a finished product.
    if (next !== "adj:FOUND" && isRaw && mode === "IN") setItem(products[0] ? `FINISHED:${products[0].id}` : "");
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
        fromFacilityId: mode === "IN" ? fromChannelFacilityId : fromFacilityId || null,
        fromDestination: fromRoot,
        toFacilityId: isTransfer ? effectiveTarget.slice("facility:".length) : null,
        toDestination: isTransfer ? null : effectiveTarget,
        adjustment: adjReason ? { reason: adjReason, unitCost: Number(unitCost) } : null,
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

  const costOk = !adjReason || (unitCost.trim() !== "" && Number.isFinite(Number(unitCost)) && Number(unitCost) >= 0);
  const canSave =
    !!mode &&
    q > 0 &&
    !!itemId &&
    (!needsSku || !!poolSku) &&
    !!effectiveTarget &&
    costOk &&
    !overCap &&
    (mode === "IN" ? !!fromRoot || !!adjReason : !!fromFacilityId);

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
            <span className="block text-[13px] font-semibold text-ink">Inflow — bring stock in</span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">
              Back from a sales channel, a customer return, or stock a recount found.
            </span>
          </span>
        </button>
      </div>

      {mode && (
        <>
          <div className="sm:max-w-[220px]">
            <Field label="Date">
              <DatePicker
                value={dateISO}
                onChange={setDateISO}
                isDayDisabled={comboReady ? (d) => capOn(timeline, d) <= 1e-9 : undefined}
                dayTitle={
                  comboReady
                    ? (d) => {
                        const c = Math.floor(capOn(timeline, d));
                        return c > 0 ? `Up to ${c.toLocaleString()} units can move on this day` : "No stock here on this day";
                      }
                    : undefined
                }
              />
            </Field>
          </div>

          {/* Hints in this row FLOAT (no layout space) so the inputs never shift; pb-4 reserves
              the band they hang into. */}
          <div className="flex flex-wrap items-end gap-3 pb-4">
            <div className="min-w-[240px] flex-1">
              <Field
                label="What's moving?"
                floatHint
                hint={nothingToMove ? "Nothing is in stock at this facility — pick a different source." : undefined}
              >
                <IconSelect
                  value={item}
                  onChange={(v) => { setItem(v); setPoolSku(""); }}
                  groups={itemGroups}
                  emptyNote="Nothing is in stock at this facility."
                />
              </Field>
            </div>

            {needsSku && (
              <div className="min-w-[160px]">
                <Field label="For which product?" floatHint hint="Stocked separately per product.">
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

            <Field
              label="Units"
              floatHint
              hintSide="right"
              hint={comboReady ? `Up to ${Math.floor(dateCap).toLocaleString()} on this date` : undefined}
            >
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

            {adjReason && (
              <Field label="Cost per unit" floatHint hintSide="right" hint="Prefilled with the newest known cost.">
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  placeholder="0.00"
                  className={`${inputCls} tabular max-w-32 text-right`}
                />
              </Field>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={
                <span className="flex items-center gap-1.5">
                  <ArrowOutbound size={14} className="text-muted" /> Moving from
                </span>
              }
              hint={
                adjReason
                  ? adjReason === "FOUND"
                    ? "Stock the books didn't know about — it enters at the cost you set."
                    : "It re-enters your stock at the cost you set."
                  : mode === "IN"
                    ? "The units re-enter at the cost they had when they went to the channel."
                    : comboReady
                      ? `${Math.floor(dateCap).toLocaleString()} available on this date`
                      : `${Math.round(available).toLocaleString()} on hand here`
              }
            >
              <IconSelect value={source} onChange={pickSource} groups={sourceGroups} />
            </Field>

            <Field
              label={
                <span className="flex items-center gap-1.5">
                  <ArrowInbound size={14} className="text-muted" /> Moving to
                </span>
              }
            >
              <IconSelect value={effectiveTarget} onChange={setTarget} groups={adjReason ? targetGroups.slice(0, 1) : targetGroups} />
            </Field>
          </div>

          <Field label="Note" hint="Optional — e.g. a shipment or reference number.">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Reference / note" />
          </Field>

          {overCap && q > 0 && (
            <div className="flex items-start gap-1.5 rounded-lg border border-[#f0d3cb] bg-[#fdf2ef] px-3 py-2 text-[12.5px] text-negative">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                Only {Math.floor(dateCap).toLocaleString()} units were here on this date — the rest either arrived later or already
                moved out.
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
  costHints,
  availability = [],
}: {
  products: MoveProduct[];
  materials: MoveMaterial[];
  facilities: MoveFacility[];
  onHand: OnHandRow[];
  todayISO: string;
  channelFacilities?: MoveChannelFacility[];
  costHints?: CostHints;
  availability?: AvailabilityEvent[];
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
        costHints={costHints}
        availability={availability}
        onDone={() => setOpen(false)}
      />
    </div>
  );
}
