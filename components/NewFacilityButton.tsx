"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { FACILITY_TYPES } from "@/lib/facility-types";
import { createFacility } from "@/app/facilities/actions";

const inputCls = "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent-strong";

export function NewFacilityButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("co-packer");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    const r = await createFacility({ code, name, type });
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setOpen(false);
    setCode("");
    setName("");
    router.push(`/facilities/${r.id}`);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90"
      >
        <Plus size={15} /> New facility
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink">New facility</h3>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-muted">Short code</span>
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={inputCls} placeholder="e.g. WH1" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-muted">Facility name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. East Coast 3PL" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-muted">Type</span>
                <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
                  {FACILITY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label} — {t.hint}
                    </option>
                  ))}
                </select>
              </label>
              {error && <div className="text-[12px] text-negative">{error}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setOpen(false)} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={pending || !code.trim() || !name.trim()}
                  className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
                >
                  {pending ? "Saving…" : "Create facility"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
