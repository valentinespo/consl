"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, AlertTriangle } from "@/components/icons";
import { DatePicker } from "@/components/DatePicker";
import { createPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder, type PoLineInput } from "@/app/purchase-orders/actions";
import { TwoStepDelete } from "@/components/TwoStepDelete";
import { SkuAvatar } from "@/components/ui";
import { useMoney } from "@/components/CurrencyProvider";

export type PoFacility = { id: string; code: string; name: string; legalName: string; address: string };
export type PoProduct = {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  lastCost: number | null;
  lastPoNumber: string | null;
};

export type PoRowLine = {
  kind: string;
  productId: string | null;
  description: string;
  unitCost: number | null;
  quantity: number;
  lotUnits: number | null;
};
export type PoRow = {
  id: string;
  number: string;
  dateISO: string;
  facilityId: string;
  lotNr: number | null;
  lines: PoRowLine[];
};

type EditLine = {
  key: string;
  kind: "SKU" | "FEE";
  productId: string;
  description: string;
  unitCost: string;
  quantity: string;
  ratio: string; // PO units per ONE lot unit — qty ÷ ratio = lot units (e.g. 15 tea bags → 1 pouch)
  lotUnits: string;
  costFromPo?: string | null; // set when unitCost was prefilled from the most recent PO
  descAuto?: boolean; // description was auto-filled (safe to replace on SKU/vendor change)
};

const inputCls = "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent-strong";

let seq = 0;
const newKey = () => `po${seq++}`;

/** qty ÷ ratio, trimmed to 2 decimals — blank while qty is blank so the field stays quiet. */
function lotUnitsFrom(qtyStr: string, ratioStr: string): string {
  const q = Number(qtyStr) || 0;
  if (!qtyStr.trim() || q <= 0) return "";
  const r = Number(ratioStr) || 0;
  return String(Math.round((q / (r > 0 ? r : 1)) * 100) / 100);
}

/** Reconstruct the divider from a saved line (27,000 bags → 1,800 pouches ⇒ 15). */
function ratioFrom(quantity: number, lotUnits: number | null): string {
  if (!quantity || !lotUnits || lotUnits <= 0) return "1";
  return String(Math.round((quantity / lotUnits) * 10000) / 10000);
}

export function PoForm({
  facilities,
  products,
  descSeeds = {},
  feeDescs = [],
  nextLotNr,
  po,
  todayISO,
  onDone,
}: {
  facilities: PoFacility[];
  products: PoProduct[];
  descSeeds?: Record<string, string>; // "facilityId|productId" -> description on the most recent PO
  feeDescs?: string[]; // previously used fee descriptions, offered as suggestions
  nextLotNr: number;
  po?: PoRow | null; // present = edit mode
  todayISO: string;
  onDone: () => void;
}) {
  const { money } = useMoney();
  const editing = !!po;
  const router = useRouter();
  // The form's pristine state — what Discard returns to, and what dirty is measured against.
  const initFacilityId = po?.facilityId ?? "";
  const initDateISO = po?.dateISO ?? todayISO;
  const initLines = (): EditLine[] =>
    po && po.lines.length
      ? po.lines.map((l) => ({
          key: newKey(),
          kind: (l.kind === "FEE" ? "FEE" : "SKU") as "SKU" | "FEE",
          productId: l.productId ?? "",
          description: l.description,
          unitCost: l.unitCost == null ? "" : String(l.unitCost),
          quantity: String(l.quantity),
          ratio: ratioFrom(l.quantity, l.lotUnits),
          lotUnits: l.lotUnits == null ? "" : String(l.lotUnits),
        }))
      : [{ key: newKey(), kind: "SKU", productId: "", description: "", unitCost: "", quantity: "", ratio: "1", lotUnits: "" }];
  const [facilityId, setFacilityId] = useState(initFacilityId);
  const [dateISO, setDateISO] = useState(initDateISO);
  const [lines, setLines] = useState<EditLine[]>(initLines);
  const [pending, setPending] = useState(false);
  const [delStep, setDelStep] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Key-independent signature, so freshly built initial lines compare equal to untouched state.
  const sig = (fac: string, date: string, ls: EditLine[]) =>
    JSON.stringify([fac, date, ls.map((l) => [l.kind, l.productId, l.description, l.unitCost, l.quantity, l.ratio, l.lotUnits])]);
  const initSig = useMemo(() => sig(initFacilityId, initDateISO, initLines()), []); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = sig(facilityId, dateISO, lines) !== initSig;

  function discard() {
    setFacilityId(initFacilityId);
    setDateISO(initDateISO);
    setLines(initLines());
    setError(null);
    setConfirmRemove(null);
    setDelStep(0);
  }

  const facility = facilities.find((f) => f.id === facilityId);
  const number = editing ? po!.number : `#${nextLotNr}-${facility?.code ?? "?"}`;

  const { total, hasTbd } = useMemo(() => {
    let t = 0;
    let tbd = false;
    for (const l of lines) {
      if (!l.description.trim() && !Number(l.quantity)) continue;
      if (l.unitCost.trim() === "") tbd = true;
      else t += (Number(l.unitCost) || 0) * (Number(l.quantity) || 0);
    }
    return { total: t, hasTbd: tbd };
  }, [lines]);

  function patch(key: string, p: Partial<EditLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));
  }
  function addLine(kind: "SKU" | "FEE") {
    setLines((prev) => [...prev, { key: newKey(), kind, productId: "", description: "", unitCost: "", quantity: "", ratio: "1", lotUnits: "" }]);
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
    setConfirmRemove(null);
  }
  /** Description as printed on the most recent PO to this vendor, falling back to the product name. */
  function seedDesc(prodId: string, facId: string): string {
    const p = products.find((x) => x.id === prodId);
    return descSeeds[`${facId}|${prodId}`] ?? p?.name ?? "";
  }

  function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const canDesc = l.description.trim() === "" || l.descAuto;
        // Prefill the price from the most recent PO for this SKU (only if untouched or itself a prefill).
        const canPrefill = l.unitCost.trim() === "" || l.costFromPo;
        const prefill = canPrefill && p?.lastCost != null;
        return {
          ...l,
          productId,
          description: canDesc ? seedDesc(productId, facilityId) : l.description,
          descAuto: canDesc ? true : l.descAuto,
          unitCost: prefill ? String(p!.lastCost) : l.unitCost,
          costFromPo: prefill ? p!.lastPoNumber : canPrefill ? null : l.costFromPo,
        };
      }),
    );
  }

  /** Changing vendor re-seeds any auto-filled descriptions for the new vendor's phrasing. */
  function changeFacility(newId: string) {
    setFacilityId(newId);
    setLines((prev) =>
      prev.map((l) =>
        l.kind === "SKU" && l.productId && l.descAuto ? { ...l, description: seedDescFor(l.productId, newId) } : l,
      ),
    );
    function seedDescFor(prodId: string, facId: string): string {
      const p = products.find((x) => x.id === prodId);
      return descSeeds[`${facId}|${prodId}`] ?? p?.name ?? "";
    }
  }

  async function submit() {
    setError(null);
    setPending(true);
    try {
      const payload = {
        id: po?.id ?? null,
        facilityId,
        dateISO,
        lines: lines
          .filter((l) => l.description.trim() || Number(l.quantity))
          .map(
            (l): PoLineInput => ({
              kind: l.kind,
              productId: l.kind === "SKU" ? l.productId || null : null,
              description: l.description,
              unitCost: l.unitCost.trim() === "" ? null : Number(l.unitCost) || 0,
              quantity: Number(l.quantity) || 0,
              lotUnits: l.kind === "SKU" ? Number(l.lotUnits || l.quantity) || 0 : null,
            }),
          ),
      };
      const res = editing ? await updatePurchaseOrder(payload) : await createPurchaseOrder(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // The create form stays mounted after a successful save (the edit form unmounts when its
      // row collapses) — clear it back to a blank slate so it's ready for the next PO. Without
      // this the button sat on "Creating…" forever even though the PO had been created.
      if (!editing) {
        setLines([{ key: newKey(), kind: "SKU", productId: "", description: "", unitCost: "", quantity: "", ratio: "1", lotUnits: "" }]);
        setDateISO(todayISO);
      }
      onDone();
      router.refresh();
    } catch {
      setError("Couldn't reach the server — the PO may still have been created. Refresh the page to check before retrying.");
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    if (!po) return;
    setPending(true);
    const res = await deletePurchaseOrder(po.id);
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      setDelStep(0);
      return;
    }
    onDone();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Vendor (facility)">
          <select value={facilityId} onChange={(e) => changeFacility(e.target.value)} className={inputCls} disabled={editing}>
            <option value="">Select…</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} — {f.legalName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="PO date">
          <DatePicker value={dateISO} onChange={setDateISO} />
        </Field>
        <Field label="PO number">
          <div className="flex h-9 items-center rounded-lg border border-line bg-surface-2 px-2.5 text-[13px] font-semibold tabular text-ink">{number}</div>
        </Field>
      </div>

      {facility && (
        <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-muted">
          <span className="font-medium text-ink-soft">{facility.legalName}</span>
          {facility.address ? (
            ` · ${facility.address.replace(/\n/g, ", ")}`
          ) : (
            <>
              {" · "}
              <AlertTriangle size={12} className="inline-block align-[-1.5px]" /> no address on file (edit the facility)
            </>
          )}
        </div>
      )}

      {/* Lines */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-muted">Order lines</span>
          <span className="text-[12px] tabular text-ink-soft">
            Total: <span className="font-semibold text-ink">{hasTbd ? "TBD" : money(total, 2)}</span>
            {hasTbd && total > 0 && <span className="text-muted"> ({money(total, 2)} + TBD lines)</span>}
          </span>
        </div>

        {lines.map((l) => {
          const prod = products.find((p) => p.id === l.productId);
          const isSku = l.kind === "SKU";
          return (
            <div key={l.key} className={`rounded-lg border border-border bg-surface p-2.5 ${l.costFromPo ? "pb-7" : ""}`}>
              <div className="flex flex-wrap items-end gap-2">
                <MiniField label="Type" className="w-[86px]">
                  <select value={l.kind} onChange={(e) => patch(l.key, { kind: e.target.value as "SKU" | "FEE" })} className={inputCls}>
                    <option value="SKU">SKU</option>
                    <option value="FEE">Fee</option>
                  </select>
                </MiniField>
                {isSku && (
                  <MiniField label="SKU" className="w-[150px]">
                    <div className="flex items-center gap-2">
                      {prod && <SkuAvatar code={prod.code} imageUrl={prod.imageUrl} size={26} />}
                      <div className="min-w-0 flex-1">
                        <select value={l.productId} onChange={(e) => pickProduct(l.key, e.target.value)} className={inputCls}>
                          <option value="">Select…</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.code}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </MiniField>
                )}
                <MiniField label="Description (as printed on the PO)" className="min-w-[200px] flex-1">
                  <input
                    value={l.description}
                    onChange={(e) => patch(l.key, { description: e.target.value, descAuto: false })}
                    placeholder={isSku ? "e.g. Product name | pack size" : "e.g. testing, freight, samples"}
                    list={!isSku && feeDescs.length > 0 ? "po-fee-descs" : undefined}
                    className={inputCls}
                  />
                </MiniField>
                <MiniField label="Unit cost ($)" className="w-[100px]">
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      value={l.unitCost}
                      onChange={(e) => patch(l.key, { unitCost: e.target.value, costFromPo: null })}
                      placeholder="TBD"
                      className={`${inputCls} text-right tabular`}
                    />
                    {l.costFromPo && (
                      <span className="absolute left-0 top-full mt-0.5 whitespace-nowrap text-[10px] leading-tight text-muted/80">
                        from last PO {l.costFromPo}
                      </span>
                    )}
                  </div>
                </MiniField>
                <MiniField label="Qty" className="w-[90px]">
                  <input
                    type="number"
                    step="any"
                    value={l.quantity}
                    onChange={(e) => {
                      const p: Partial<EditLine> = { quantity: e.target.value };
                      // lot units follow qty through the divider (÷1 by default)
                      if (isSku) p.lotUnits = lotUnitsFrom(e.target.value, l.ratio);
                      patch(l.key, p);
                    }}
                    placeholder="0"
                    className={`${inputCls} text-right tabular`}
                  />
                </MiniField>
                {isSku && (
                  <>
                    {/* The qty → lot-units bridge, reading as arithmetic: qty ÷ [this] = lot units
                        (e.g. 27,000 tea bags ÷ 15 = 1,800 pouches). Small and quiet. */}
                    <div
                      className="flex h-9 items-center gap-1.5 self-end"
                      title="Order units per ONE lot unit — qty ÷ this = lot units (e.g. 15 tea bags make 1 pouch)"
                    >
                      <span className="text-[13px] text-muted">÷</span>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={l.ratio}
                        onChange={(e) => patch(l.key, { ratio: e.target.value, lotUnits: lotUnitsFrom(l.quantity, e.target.value) })}
                        placeholder="1"
                        className="h-9 w-[50px] rounded-lg border border-border bg-surface px-1 text-center text-[13px] tabular text-ink outline-none focus:border-accent-strong"
                      />
                      <span className="text-[13px] text-muted">=</span>
                    </div>
                    <MiniField label="Lot units" className="w-[90px]" hint="Finished units the lot produces — qty ÷ the divider. Type here to set it directly; the divider follows.">
                      <input
                        type="number"
                        step="1"
                        value={l.lotUnits}
                        onChange={(e) => {
                          const v = e.target.value;
                          // Typing lot units directly re-derives the divider, so the trio stays consistent.
                          patch(l.key, { lotUnits: v, ratio: ratioFrom(Number(l.quantity) || 0, Number(v) || 0) });
                        }}
                        placeholder="= qty"
                        className={`${inputCls} text-right tabular`}
                      />
                    </MiniField>
                  </>
                )}
                <div className="flex h-9 w-[90px] items-center justify-end px-1 text-[12.5px] tabular text-muted">
                  {l.unitCost.trim() === "" ? "TBD" : money((Number(l.unitCost) || 0) * (Number(l.quantity) || 0), 2)}
                </div>
                {confirmRemove === l.key ? (
                  <button type="button" onClick={() => removeLine(l.key)} className="mb-0.5 whitespace-nowrap rounded-lg bg-negative px-2 py-2 text-[11.5px] font-medium text-white hover:opacity-90">
                    Remove?
                  </button>
                ) : (
                  <button type="button" onClick={() => setConfirmRemove(l.key)} disabled={lines.length === 1} title="Remove line" className="mb-0.5 inline-flex h-9 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-negative disabled:opacity-30">
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <div className="flex gap-2">
          <button type="button" onClick={() => addLine("SKU")} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-surface-2 disabled:opacity-40">
            <Plus size={14} /> Add SKU line
          </button>
          <button type="button" onClick={() => addLine("FEE")} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:bg-surface-2">
            <Plus size={14} /> Add fee line
          </button>
        </div>
      </div>

      <p className="text-[11.5px] text-muted">
        {editing
          ? `Saving regenerates the PDF. Lot #${po!.lotNr ?? "—"} is not modified — edit it from Production Lots.`
          : `Generating creates production Lot #${nextLotNr} at ${facility?.code ?? "…"} with the SKU lines' lot units, plus the PO PDF. Leave unit cost empty for "TBD".`}
      </p>

      {error && <div className="rounded-lg border border-[#f0d3cb] bg-[#fdf2ef] px-3 py-2 text-[12.5px] text-negative">{error}</div>}

      <div className="flex items-center justify-between pt-1">
        <div>
          {editing && (
            <TwoStepDelete
              step={delStep}
              setStep={setDelStep}
              pending={pending}
              onConfirm={remove}
              noun="purchase order"
              finalWarning={po!.lotNr != null ? `This also deletes Lot #${po!.lotNr} and its production data.` : undefined}
            />
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={discard}
            disabled={!dirty || pending}
            title={dirty ? "Throw away your edits and restore the form" : "No changes to discard"}
            className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !facilityId}
            title={!facilityId ? "Pick a vendor first" : undefined}
            className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Working…" : editing ? "Save & regenerate PDF" : "Generate PO + lot"}
          </button>
        </div>
      </div>
      {feeDescs.length > 0 && (
        <datalist id="po-fee-descs">
          {feeDescs.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
function MiniField({ label, children, className = "", hint }: { label: string; children: React.ReactNode; className?: string; hint?: string }) {
  return (
    <label className={`block ${className}`} title={hint}>
      <span className="mb-1 block truncate text-[10.5px] font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}
