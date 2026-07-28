"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "@/components/icons";
import { DatePicker } from "@/components/DatePicker";
import { Card, SkuAvatar, SectionTitle } from "@/components/ui";
import { useMoney } from "@/components/CurrencyProvider";
import { updateLot } from "@/app/lots/actions";
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

const materialLabel = (code: string) => ({ POUCH: "pouches", TEABAG: "tea bags" } as Record<string, string>)[code] ?? code.toLowerCase();
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
}: {
  lotId: string;
  initial: {
    poNumber: string | null;
    poDateISO: string | null;
    facilityId: string;
    status: "IN_PRODUCTION" | "FINISHED";
    finishedAtISO: string | null;
    notes: string | null;
  };
  initialLines: EditorLine[];
  facilities: Facility[];
  products: Product[];
  materialTypes: MaterialType[];
  skuTxnCounts: Record<string, number>;
}) {
  const { perUnit, qty } = useMoney();
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
      cost: { costs: l.costs, cogPerUnit: l.cogPerUnit, shortfalls: l.shortfalls },
    }));
    const bom = deriveBom(initialLines.map((l) => ({ key: l.id ?? `seed-${l.productId}`, materials: l.materials })));
    return { lines, shared: bom.shared, overrides: bom.overrides };
  }, [initialLines]);

  const [poNumber, setPoNumber] = useState(initial.poNumber ?? "");
  const [poDateISO, setPoDateISO] = useState(initial.poDateISO ?? "");
  const [facilityId, setFacilityId] = useState(initial.facilityId);
  const [status, setStatus] = useState(initial.status);
  const [finishedAtISO, setFinishedAtISO] = useState(initial.finishedAtISO ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [lines, setLines] = useState<StateLine[]>(seed.lines);
  const [shared, setShared] = useState<Mat[]>(seed.shared);
  const [overrides, setOverrides] = useState<Record<string, Mat[]>>(seed.overrides);
  const [addProductId, setAddProductId] = useState("");
  const [addUnits, setAddUnits] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facility = facilities.find((f) => f.id === facilityId);
  const availableProducts = products.filter((p) => !lines.some((l) => l.productId === p.id));
  const totalUnits = lines.reduce((s, l) => s + (Number(l.units) || 0), 0);

  // ---- Dirty tracking ----
  const snapshot = (
    pn: string, pd: string, fac: string, st: string, fin: string, nt: string, ls: StateLine[], sh: Mat[], ov: Record<string, Mat[]>,
  ) => {
    const keys = new Set(ls.map((l) => l.key));
    const cleanOv = Object.fromEntries(Object.entries(ov).filter(([k]) => keys.has(k)).map(([k, v]) => [k, matSig(v)]));
    return JSON.stringify({
      pn: pn.trim(), pd, fac, st, fin: st === "FINISHED" ? fin : "", nt: nt.trim(),
      l: ls.map((l) => `${l.id ?? "NEW"}|${l.productId}|${Number(l.units) || 0}`),
      sh: matSig(sh), ov: cleanOv,
    });
  };
  const current = snapshot(poNumber, poDateISO, facilityId, status, finishedAtISO, notes, lines, shared, overrides);
  const original = useMemo(
    () => snapshot(initial.poNumber ?? "", initial.poDateISO ?? "", initial.facilityId, initial.status, initial.finishedAtISO ?? "", initial.notes ?? "", seed.lines, seed.shared, seed.overrides),
    [initial, seed],
  );
  const dirty = current !== original;

  function bomFor(key: string): Mat[] {
    return overrides[key] ?? shared;
  }
  function addSku() {
    const p = products.find((x) => x.id === addProductId);
    if (!p) return;
    setLines((prev) => [
      ...prev,
      { key: `new-${tempSeq++}`, id: null, productId: p.id, code: p.code, name: p.name, imageUrl: p.imageUrl, units: addUnits || "0", cost: null },
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
    setStatus(initial.status);
    setFinishedAtISO(initial.finishedAtISO ?? "");
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
    setError(null);
    setPending(true);
    const res = await updateLot({
      lotId,
      poNumber: poNumber.trim() || null,
      poDateISO: poDateISO || null,
      facilityId,
      status,
      finishedAtISO: status === "FINISHED" ? finishedAtISO || null : null,
      notes: notes.trim() || null,
      lines: lines.map((l) => ({ id: l.id, productId: l.productId, units: Number(l.units) || 0, materials: bomFor(l.key) })),
    });
    if (!res.ok) {
      setError(res.error ?? "Could not save.");
      setPending(false);
      return;
    }
    router.refresh(); // lot.updatedAt changes → the page remounts this editor with fresh data
  }

  const bomLines = lines.map((l) => ({ key: l.key, sku: l.code, productName: l.name, imageUrl: l.imageUrl, units: Number(l.units) || 0 }));

  return (
    <div>
      {/* Details */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="PO number"><input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="#7-CCP" className={inputCls} /></Field>
        <Field label="PO date"><DatePicker value={poDateISO} onChange={setPoDateISO} /></Field>
        <Field label="Facility">
          <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className={inputCls}>
            {facilities.map((f) => (<option key={f.id} value={f.id}>{f.code} — {f.name}</option>))}
          </select>
        </Field>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => {
              const next = e.target.value as "IN_PRODUCTION" | "FINISHED";
              setStatus(next);
              // Flipping to Finished proposes today; the field stays fully editable and is the
              // lot's single source of truth — flipping back to production erases it on save.
              if (next === "FINISHED" && !finishedAtISO) setFinishedAtISO(new Date().toLocaleDateString("en-CA"));
            }}
            className={inputCls}
          >
            <option value="IN_PRODUCTION">In production</option>
            <option value="FINISHED">Finished</option>
          </select>
        </Field>
        {status === "FINISHED" && (
          <Field label="Finished date">
            <DatePicker value={finishedAtISO} onChange={setFinishedAtISO} clearable />
          </Field>
        )}
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
                <th className="px-4 py-2.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const txnCount = skuTxnCounts[l.code] ?? 0;
                return (
                  <tr key={l.key} className="border-b border-line last:border-0">
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
                        onChange={(e) => setLines((prev) => prev.map((x) => (x.key === l.key ? { ...x, units: e.target.value } : x)))}
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
                                {c.short ? "⚠" : perUnit(c.value)}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular text-ink">{l.cost ? perUnit(l.cost.cogPerUnit) : <span className="text-[11px] font-normal text-muted">new</span>}</td>
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
              Unsaved changes · {lines.length} SKU{lines.length === 1 ? "" : "s"} · {qty(totalUnits)} units
            </span>
            {error && <span className="text-[12px] text-negative">{error}</span>}
            <button onClick={reset} disabled={pending} className="rounded-full border border-[#e7cfc8] px-3.5 py-1.5 text-[12.5px] font-medium text-negative hover:bg-[#fbf1ee] disabled:opacity-50">Discard</button>
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
