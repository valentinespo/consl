"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Trash2 } from "lucide-react";
import { createLot } from "@/app/lots/actions";
import { SelectOrCreate, type Opt } from "@/components/SelectOrCreate";

const inputCls = "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent-strong";

type Facility = { id: string; code: string; name: string };
type Product = { id: string; code: string; name: string };
type Line = { key: number; productId: string; units: string };

const productOpts = (products: Product[]): Opt[] => products.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }));

export function NewLotButton({ facilities, products }: { facilities: Facility[]; products: Product[] }) {
  const [open, setOpen] = useState(false);
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [status, setStatus] = useState<"IN_PRODUCTION" | "FINISHED">("IN_PRODUCTION");
  const [lines, setLines] = useState<Line[]>([{ key: 1, productId: "", units: "" }]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const opts = productOpts(products);

  function reset() {
    setPoNumber("");
    setPoDate("");
    setFacilityId(facilities[0]?.id ?? "");
    setStatus("IN_PRODUCTION");
    setLines([{ key: 1, productId: "", units: "" }]);
    setError(null);
  }

  async function save() {
    setPending(true);
    setError(null);
    const r = await createLot({
      poNumber: poNumber || null,
      poDateISO: poDate || null,
      facilityId,
      status,
      lines: lines.map((l) => ({ productId: l.productId, units: Number(l.units) || 0 })),
    });
    setPending(false);
    if (!r.ok) {
      setError(r.error ?? "Failed to create lot");
      return;
    }
    setOpen(false);
    reset();
    router.push(`/lots/${r.lotId}`);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90">
        <Plus size={16} /> New lot
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink">New production lot</h3>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Facility">
                  <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className={inputCls}>
                    {facilities.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.code} — {f.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select value={status} onChange={(e) => setStatus(e.target.value as "IN_PRODUCTION" | "FINISHED")} className={inputCls}>
                    <option value="IN_PRODUCTION">In production</option>
                    <option value="FINISHED">Finished</option>
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="PO number (optional)">
                  <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className={inputCls} placeholder="auto" />
                </Field>
                <Field label="PO date">
                  <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className={inputCls} />
                </Field>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[12px] font-medium text-muted">SKUs produced</span>
                  <button
                    onClick={() => setLines((p) => [...p, { key: Date.now(), productId: "", units: "" }])}
                    className="text-[12px] font-medium text-accent hover:underline"
                  >
                    + Add SKU
                  </button>
                </div>
                <div className="space-y-2">
                  {lines.map((ln, i) => (
                    <div key={ln.key} className="flex items-center gap-2">
                      <div className="flex-1">
                        <SelectOrCreate
                          value={ln.productId}
                          onChange={(v) => setLines((p) => p.map((x) => (x.key === ln.key ? { ...x, productId: v } : x)))}
                          options={opts}
                          placeholder="Select SKU…"
                        />
                      </div>
                      <input
                        type="number"
                        value={ln.units}
                        onChange={(e) => setLines((p) => p.map((x) => (x.key === ln.key ? { ...x, units: e.target.value } : x)))}
                        placeholder="Units"
                        className="h-9 w-24 rounded-lg border border-border bg-surface px-2.5 text-right text-[13px] tabular outline-none focus:border-accent-strong"
                      />
                      {lines.length > 1 && (
                        <button onClick={() => setLines((p) => p.filter((x) => x.key !== ln.key))} className="text-muted hover:text-negative" title="Remove">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {error && <div className="text-[12px] text-negative">{error}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setOpen(false)} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
                  Cancel
                </button>
                <button onClick={save} disabled={pending} className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50">
                  {pending ? "Creating…" : "Create lot"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
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
