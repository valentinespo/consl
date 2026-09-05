"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, X, AlertTriangle, ChevronDown, Pencil } from "@/components/icons";
import { DatePicker } from "@/components/DatePicker";
import { Card, SkuAvatar, SectionTitle } from "@/components/ui";
import { StatusDropdown } from "@/components/StatusDropdown";
import { useMoney } from "@/components/CurrencyProvider";
import { inflectUnit } from "@/lib/format";
import { updateLot } from "@/app/lots/actions";
import { deriveProduction, derivePayment, PRODUCTION_LABEL, PAYMENT_LABEL, DERIVED_PILL_CLS } from "@/lib/lot-status";
import { LotBom, type MaterialType, type Mat } from "@/components/LotBom";
import type { CostChip } from "@/lib/lot-costs";

type Facility = { id: string; code: string; name: string };
type Product = { id: string; code: string; name: string; imageUrl: string | null };
type Shortfall = { materialCode: string; shortBy: number; demand: number };

export type EditorLine = {
  id: string | null;
  productId: string;
  code: string;
  name: string;
  imageUrl: string | null;
  units: number;
  // Per-SKU lifecycle — SKUs in one lot finish (and get paid for) independently.
  status: "IN_PRODUCTION" | "FINISHED";
  paymentStatus: "PAID" | "DUE";
  finishedAtISO: string | null;
  expiryISO: string | null;
  batchNr: string | null;
  materials: Mat[];
  costs: CostChip[];
  cogPerUnit: number;
  shortfalls: Shortfall[];
};

type StateLine = {
  key: string;
  id: string | null;
  productId: string;
  code: string;
  name: string;
  imageUrl: string | null;
  units: string;
  status: "IN_PRODUCTION" | "FINISHED";
  paymentStatus: "PAID" | "DUE";
  finishedAtISO: string;
  expiryISO: string;
  batchNr: string;
  cost: { costs: CostChip[]; cogPerUnit: number; shortfalls: Shortfall[] } | null;
};

const matSig = (m: Mat[]) =>
  m.slice().sort((a, b) => a.materialTypeId.localeCompare(b.materialTypeId)).map((x) => `${x.materialTypeId}:${x.perUnit}`).join("|");

function deriveBom(lines: { key: string; materials: Mat[] }[]) {
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(matSig(l.materials), (counts.get(matSig(l.materials)) ?? 0) + 1);
  let bestSig = "";
  let best = -1;
  for (const [s, c] of counts) if (c > best) { best = c; bestSig = s; }
  const shared = (lines.find((l) => matSig(l.materials) === bestSig)?.materials ?? []).map((m) => ({ ...m }));
  const overrides: Record<string, Mat[]> = {};
  for (const l of lines) if (matSig(l.materials) !== bestSig) overrides[l.key] = l.materials.map((m) => ({ ...m }));
  return { shared, overrides };
}

const inputCls = "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent-strong";

let tempSeq = 0;

export function LotEditor({
  lotId,
  initial,
  initialLines,
  facilities,
  products,
  materialTypes,
  skuTxnCounts,
  totalCog,
}: {
  lotId: string;
  initial: {
    poNumber: string | null;
    poDateISO: string | null;
    facilityId: string;
    notes: string | null;
  };
  initialLines: EditorLine[];
  facilities: Facility[];
  products: Product[];
  materialTypes: MaterialType[];
  skuTxnCounts: Record<string, number>;
  totalCog: number; // saved COG snapshot for the hero card (refreshes after a save)
}) {
  const { money, perUnit, qty } = useMoney();
  const router = useRouter();
  const seed = useMemo(() => {
    const lines: StateLine[] = initialLines.map((l) => ({
      key: l.id ?? `seed-${l.productId}`,
      id: l.id,
      productId: l.productId,
      code: l.code,
      name: l.name,
      imageUrl: l.imageUrl,
      units: String(l.units),
      status: l.status,
      paymentStatus: l.paymentStatus,
      finishedAtISO: l.finishedAtISO ?? "",
      expiryISO: l.expiryISO ?? "",
      batchNr: l.batchNr ?? "",
      cost: { costs: l.costs, cogPerUnit: l.cogPerUnit, shortfalls: l.shortfalls },
    }));
    const bom = deriveBom(initialLines.map((l) => ({ key: l.id ?? `seed-${l.productId}`, materials: l.materials })));
    return { lines, shared: bom.shared, overrides: bom.overrides };
  }, [initialLines]);

  const [poNumber, setPoNumber] = useState(initial.poNumber ?? "");
  const [poDateISO, setPoDateISO] = useState(initial.poDateISO ?? "");
  const [facilityId, setFacilityId] = useState(initial.facilityId);
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [lines, setLines] = useState<StateLine[]>(seed.lines);
  const [shared, setShared] = useState<Mat[]>(seed.shared);
  const [overrides, setOverrides] = useState<Record<string, Mat[]>>(seed.overrides);
  const [addProductId, setAddProductId] = useState("");
  const [addUnits, setAddUnits] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The page header reserves a slot for the status pills; the editor portals its dropdowns there
  // so status/payment stay part of THIS form's staged state and single save bar.
  const [pillSlot, setPillSlot] = useState<Element | null>(null);
  useEffect(() => setPillSlot(document.getElementById("lot-status-slot")), []);

  const facility = facilities.find((f) => f.id === facilityId);
  const availableProducts = products.filter((p) => !lines.some((l) => l.productId === p.id));
  const totalUnits = lines.reduce((s, l) => s + (Number(l.units) || 0), 0);
  // Lot-level statuses are DERIVED from the lines — live, so the header pills preview staged edits.
  const derivedProd = deriveProduction(lines);
  const derivedPay = derivePayment(lines);

  // ---- Dirty tracking ----
  const lineSig = (l: StateLine) => {
    const fin = l.status === "FINISHED";
    return `${l.id ?? "NEW"}|${l.productId}|${Number(l.units) || 0}|${l.status}|${l.paymentStatus}|${fin ? l.finishedAtISO : ""}|${fin ? l.expiryISO : ""}|${fin ? l.batchNr.trim() : ""}`;
  };
  const snapshot = (pn: string, pd: string, fac: string, nt: string, ls: StateLine[], sh: Mat[], ov: Record<string, Mat[]>) => {
    const keys = new Set(ls.map((l) => l.key));
    const cleanOv = Object.fromEntries(Object.entries(ov).filter(([k]) => keys.has(k)).map(([k, v]) => [k, matSig(v)]));
    return JSON.stringify({
      pn: pn.trim(), pd, fac, nt: nt.trim(),
      l: ls.map(lineSig),
      sh: matSig(sh), ov: cleanOv,
    });
  };
  const current = snapshot(poNumber, poDateISO, facilityId, notes, lines, shared, overrides);
  const original = useMemo(
    () => snapshot(initial.poNumber ?? "", initial.poDateISO ?? "", initial.facilityId, initial.notes ?? "", seed.lines, seed.shared, seed.overrides),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initial, seed],
  );
  const dirty = current !== original;

  const patchLine = (key: string, patch: Partial<StateLine>) =>
    setLines((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function bomFor(key: string): Mat[] {
    return overrides[key] ?? shared;
  }
  function addSku() {
    const p = products.find((x) => x.id === addProductId);
    if (!p) return;
    setLines((prev) => [
      ...prev,
      {
        key: `new-${tempSeq++}`,
        id: null,
        productId: p.id,
        code: p.code,
        name: p.name,
        imageUrl: p.imageUrl,
        units: addUnits || "0",
        status: "IN_PRODUCTION",
        paymentStatus: "DUE",
        finishedAtISO: "",
        expiryISO: "",
        batchNr: "",
        cost: null,
      },
    ]);
    setAddProductId("");
    setAddUnits("");
  }
  function removeSku(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
    setOverrides((prev) => {
      const n = { ...prev };
      delete n[key];
      return n;
    });
    setConfirmRemove(null);
  }
  function reset() {
    setPoNumber(initial.poNumber ?? "");
    setPoDateISO(initial.poDateISO ?? "");
    setFacilityId(initial.facilityId);
    setNotes(initial.notes ?? "");
    setLines(seed.lines);
    setShared(seed.shared);
    setOverrides(seed.overrides);
    setAddProductId("");
    setAddUnits("");
    setConfirmRemove(null);
    setError(null);
  }
  async function save() {
    // Finished SKUs must carry a date, and never one before the lot's PO date — checked here for
    // an instant message; the server enforces the same rule.
    for (const l of lines) {
      if (l.status !== "FINISHED") continue;
      if (!l.finishedAtISO) {
        setError(`${l.code} is finished — pick its finished date.`);
        return;
      }
      if (poDateISO && l.finishedAtISO < poDateISO) {
        setError(`${l.code}'s finished date is before the lot's PO date — it can't finish before the lot started.`);
        return;
      }
    }
    setError(null);
    setPending(true);
    try {
      const res = await updateLot({
        lotId,
        poNumber: poNumber.trim() || null,
        poDateISO: poDateISO || null,
        facilityId,
        notes: notes.trim() || null,
        lines: lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          units: Number(l.units) || 0,
          status: l.status,
          paymentStatus: l.paymentStatus,
          finishedAtISO: l.status === "FINISHED" ? l.finishedAtISO || null : null,
          expiryISO: l.status === "FINISHED" ? l.expiryISO || null : null,
          batchNr: l.status === "FINISHED" ? l.batchNr.trim() || null : null,
          materials: bomFor(l.key),
        })),
      });
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      router.refresh(); // lot.updatedAt changes → the page remounts this editor with fresh data
    } catch {
      // The lot commits before the cost recompute + revalidate run, so a hiccup there (or a slow
      // response) can reject here with the change already saved. Refresh to show reality and let the
      // button recover, instead of hanging on "Saving" until a manual reload.
      router.refresh();
      setError("Saved — the page was just slow to refresh. If your change isn't shown, reload.");
    } finally {
      setPending(false); // never rely on the remount alone to clear this
    }
  }

  const bomLines = lines.map((l) => ({ key: l.key, sku: l.code, productName: l.name, imageUrl: l.imageUrl, units: Number(l.units) || 0 }));

  return (
    <div>
      {/* Header pills, portaled into the page header — DERIVED from the SKU lines (live, so they
          preview staged edits). Not selectable: each SKU carries its own pills in the table below. */}
      {pillSlot &&
        createPortal(
          <>
            <span className={`${DERIVED_PILL_CLS[derivedProd]} inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium`}>
              {PRODUCTION_LABEL[derivedProd]}
            </span>
            <span className={`${DERIVED_PILL_CLS[derivedPay]} inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium`}>
              {PAYMENT_LABEL[derivedPay]}
            </span>
          </>,
          pillSlot,
        )}

      {/* Hero — the lot's key facts as cards. PO date / number / facility are editable in place
          (borderless controls that read like the value); total units + COG are read-only stats. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <HeroCard label="PO date">
          <DatePicker
            value={poDateISO}
            onChange={setPoDateISO}
            className="!h-auto !border-transparent !bg-transparent !px-0 !text-[16px] !font-semibold hover:!border-transparent focus-visible:!border-transparent"
          />
        </HeroCard>
        <HeroCard label="PO number">
          <div className="flex items-center gap-2">
            <input
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="#7-CCP"
              className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-muted"
            />
            {/* Affordance only — the whole field is editable, matching the calendar on PO date. */}
            <Pencil size={14} className="shrink-0 text-ink-soft" />
          </div>
        </HeroCard>
        <HeroCard label="Facility">
          <div className="relative">
            <select
              value={facilityId}
              onChange={(e) => setFacilityId(e.target.value)}
              style={{ appearance: "none", backgroundImage: "none" }}
              className="w-full cursor-pointer truncate bg-transparent pr-5 text-[16px] font-semibold text-ink outline-none"
            >
              {facilities.map((f) => (<option key={f.id} value={f.id}>{f.code} — {f.name}</option>))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-muted" />
          </div>
        </HeroCard>
        <HeroCard label="Total units"><div className="text-[16px] font-semibold tabular text-ink">{qty(totalUnits)}</div></HeroCard>
        <HeroCard label="Total COG"><div className="text-[16px] font-semibold tabular text-ink">{money(totalCog, 2)}</div></HeroCard>
      </div>

      {/* Cost breakdown + units + add/remove SKU */}
      <div className="mt-6">
        <SectionTitle>SKUs &amp; cost breakdown {dirty && <span className="text-[11.5px] font-normal text-muted">· costs refresh after saving</span>}</SectionTitle>
        <Card padded={false} className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">SKU</th>
                <th className="px-3 py-2.5 text-right font-medium">Units</th>
                <th className="px-3 py-2.5 font-medium">Cost breakdown / unit</th>
                <th className="px-3 py-2.5 text-right font-medium">COG/unit</th>
                <th className="px-3 py-2.5 text-center font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const txnCount = skuTxnCounts[l.code] ?? 0;
                const lineFinished = l.status === "FINISHED";
                const seedLine = seed.lines.find((s) => s.key === l.key);
                return (
                  <Fragment key={l.key}>
                  <tr className={lineFinished ? "" : "border-b border-line last:border-0"}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <SkuAvatar code={l.code} size={30} imageUrl={l.imageUrl} />
                        <div>
                          <div className="font-medium text-ink">{l.code}</div>
                          <div className="text-[11px] text-muted">{l.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <input
                        type="number" min="0" value={l.units}
                        onChange={(e) => patchLine(l.key, { units: e.target.value })}
                        className="h-8 w-20 rounded-lg border border-border bg-surface-2 px-2 text-right text-[13px] tabular text-ink outline-none focus:border-accent-strong"
                      />
                    </td>
                    <td className="px-3 py-3">
                      {l.cost && l.cost.costs.length > 0 ? (
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                          {l.cost.costs.map((c, i) => (
                            <span key={`${c.label}-${i}`} className="whitespace-nowrap text-[11px] text-muted">
                              {c.label}{" "}
                              <span className={`tabular ${c.short ? "font-semibold text-negative" : "text-ink-soft"}`} title={c.short ? "Not enough stock purchased" : undefined}>
                                {c.short ? <AlertTriangle size={11} className="inline-block align-[-1px]" /> : perUnit(c.value)}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular text-ink">{l.cost ? perUnit(l.cost.cogPerUnit) : <span className="text-[11px] font-normal text-muted">new</span>}</td>
                    {/* Per-SKU lifecycle — production + payment, staged like everything else. */}
                    <td className="px-3 py-3 text-center">
                      <div className="inline-flex flex-wrap items-center justify-center gap-1.5">
                        <StatusDropdown
                          value={l.status}
                          edited={seedLine ? l.status !== seedLine.status : l.status !== "IN_PRODUCTION"}
                          onChange={(v) => {
                            const next = v as "IN_PRODUCTION" | "FINISHED";
                            // Flipping to Finished proposes today; the field stays editable and is
                            // this SKU's source of truth — flipping back erases it on save.
                            patchLine(l.key, {
                              status: next,
                              ...(next === "FINISHED" && !l.finishedAtISO ? { finishedAtISO: new Date().toLocaleDateString("en-CA") } : {}),
                            });
                          }}
                          options={[
                            { value: "IN_PRODUCTION", label: "In production" },
                            { value: "FINISHED", label: "Finished" },
                          ]}
                        />
                        <StatusDropdown
                          value={l.paymentStatus}
                          edited={seedLine ? l.paymentStatus !== seedLine.paymentStatus : false}
                          onChange={(v) => patchLine(l.key, { paymentStatus: v as "PAID" | "DUE" })}
                          options={[
                            { value: "DUE", label: "Due" },
                            { value: "PAID", label: "Fully paid" },
                          ]}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {confirmRemove === l.key ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-[11px] text-negative">{txnCount > 0 ? `${txnCount} txn line${txnCount === 1 ? "" : "s"} → unassigned.` : "Remove?"}</span>
                          <button onClick={() => removeSku(l.key)} disabled={lines.length === 1} className="rounded-md bg-negative px-2 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-40">Remove</button>
                          <button onClick={() => setConfirmRemove(null)} className="text-[11px] text-muted hover:text-ink-soft">No</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmRemove(l.key)} disabled={lines.length === 1} title={lines.length === 1 ? "A lot needs at least one SKU" : "Remove SKU"} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-negative disabled:opacity-30"><X size={15} /></button>
                      )}
                    </td>
                  </tr>
                  {/* Finished-only details pop up as a second line under the SKU's row, on the
                      faint grey wash the app uses to mark a sub-section of the row above. */}
                  {lineFinished && (
                    <tr className="border-b border-line bg-surface-2/60 last:border-0">
                      <td colSpan={6} className="px-4 py-2.5">
                        <div className="flex flex-wrap items-end gap-3 pl-[42px]">
                          {/* Mandatory while finished (no Clear), and never before the lot's PO
                              date — locked days explain themselves on hover, like the movement
                              form's calendar. */}
                          <Field label="Finished date" className="w-[150px]">
                            <DatePicker
                              value={l.finishedAtISO}
                              onChange={(v) => patchLine(l.key, { finishedAtISO: v })}
                              isDayDisabled={poDateISO ? (d) => d < poDateISO : undefined}
                              dayTitle={poDateISO ? (d) => (d < poDateISO ? "The lot hadn't started yet on this day" : undefined) : undefined}
                            />
                          </Field>
                          <Field label="Expiry date" className="w-[150px]">
                            <DatePicker value={l.expiryISO} onChange={(v) => patchLine(l.key, { expiryISO: v })} clearable placeholder="Optional" />
                          </Field>
                          <Field label="Batch number" className="w-[150px]">
                            <input value={l.batchNr} onChange={(e) => patchLine(l.key, { batchNr: e.target.value })} placeholder="e.g. B-24137" className={inputCls} />
                          </Field>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {availableProducts.length > 0 && (
            <div className="flex flex-wrap items-end gap-2 border-t border-line p-3">
              <Field label="Add SKU" className="w-[220px]">
                <select value={addProductId} onChange={(e) => setAddProductId(e.target.value)} className={inputCls}>
                  <option value="">Select SKU…</option>
                  {availableProducts.map((p) => (<option key={p.id} value={p.id}>{p.code} — {p.name}</option>))}
                </select>
              </Field>
              <Field label="Units" className="w-[110px]">
                <input type="number" min="0" value={addUnits} onChange={(e) => setAddUnits(e.target.value)} placeholder="0" className={`${inputCls} text-right tabular`} />
              </Field>
              <button onClick={addSku} disabled={!addProductId} className="mb-0.5 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12.5px] font-medium text-ink-soft hover:bg-surface-2 disabled:opacity-40">
                <Plus size={14} /> Add
              </button>
            </div>
          )}
        </Card>
      </div>

      {/* Bill of materials */}
      <div className="mt-8">
        <LotBom lines={bomLines} materialTypes={materialTypes} shared={shared} overrides={overrides} onSharedChange={setShared} onOverridesChange={setOverrides} />
      </div>

      {/* Notes */}
      <div className="mt-8 max-w-2xl">
        <h2 className="mb-2 text-[15px] font-semibold text-ink-soft">Notes</h2>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} placeholder="Internal notes…" className="w-full rounded-[var(--radius-card)] border border-border bg-surface px-3 py-2.5 text-[13px] text-ink outline-none focus:border-accent-strong" />
      </div>

      {/* Floating save bar */}
      {dirty && (
        <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-full border border-border bg-surface/95 px-4 py-2 shadow-lg backdrop-blur">
            <span className="text-[12.5px] font-medium text-ink-soft">
              Unsaved changes · {lines.length} SKU{lines.length === 1 ? "" : "s"} · {qty(totalUnits)} {inflectUnit("unit", totalUnits)}
            </span>
            {error && <span className="text-[12px] text-negative">{error}</span>}
            <button onClick={reset} disabled={pending} className="rounded-full border btn-danger px-3.5 py-1.5 text-[12.5px] font-medium disabled:opacity-50">Discard</button>
            <button onClick={save} disabled={pending} className="rounded-full bg-ink px-4 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90 disabled:opacity-50">{pending ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/** A hero stat card (matches the page's read-only cards) whose value slot can hold an editable
 *  control — used for the PO date / number / facility fields at the top of the lot. */
function HeroCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
