"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "@/components/icons";
import { createSupplier } from "@/app/suppliers/actions";
import { useCan } from "@/components/AccessProvider";

const inputCls = "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent-strong";

export function NewSupplierButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCreate = useCan("suppliers", "create");

  async function save() {
    setPending(true);
    setError(null);
    const r = await createSupplier({ name });
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setOpen(false);
    setName("");
    router.push(`/suppliers/${r.id}`);
    router.refresh();
  }

  if (!canCreate) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90"
      >
        <Plus size={15} /> New supplier
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-ink">New supplier</h3>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-muted">Supplier name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. Pacific Botanicals"
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && save()}
                />
                <span className="mt-1 block text-[11px] text-muted">You can add contact details on the next screen.</span>
              </label>
              {error && <div className="text-[12px] text-negative">{error}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setOpen(false)} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={pending || !name.trim()}
                  className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
                >
                  {pending ? "Saving…" : "Create supplier"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
