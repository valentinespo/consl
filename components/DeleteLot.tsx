"use client";

import { useState } from "react";
import { Trash2, X } from "lucide-react";
import { deleteLot } from "@/app/lots/actions";

export function DeleteLot({ lotId, lotNr }: { lotId: string; lotNr: number }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  function close() {
    setStep(0);
    setText("");
  }

  async function confirmDelete() {
    setPending(true);
    const fd = new FormData();
    fd.set("lotId", lotId);
    await deleteLot(fd); // redirects to /lots on success
  }

  return (
    <div className="mt-8 flex items-center justify-between rounded-[var(--radius-card)] border border-[#e7cfc8] bg-[#fcf4f1] px-5 py-4">
      <div>
        <div className="text-[13.5px] font-semibold text-negative">Delete this lot</div>
        <div className="text-[12px] text-muted">Permanently removes the lot, its SKUs, bill of materials and all assigned transactions.</div>
      </div>
      <button
        onClick={() => setStep(1)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#e0b3a8] bg-surface px-3.5 py-2 text-[13px] font-medium text-negative hover:bg-[#fbeae6]"
      >
        <Trash2 size={14} /> Delete lot
      </button>

      {step > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={close}>
          <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-negative">Delete Lot #{lotNr}?</h3>
              <button onClick={close} className="text-muted hover:text-ink">
                <X size={18} />
              </button>
            </div>

            {step === 1 ? (
              <>
                <p className="text-[13px] leading-relaxed text-ink-soft">
                  This permanently deletes Lot #{lotNr}, its SKU lines and bill of materials. Its transactions are{" "}
                  <span className="font-medium">kept but unassigned</span> — they stay in the Transactions tab flagged as needing a lot.
                  Inventory and COG will be recomputed. <span className="font-medium text-negative">This cannot be undone.</span>
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={close} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
                    Cancel
                  </button>
                  <button onClick={() => setStep(2)} className="rounded-lg bg-negative px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90">
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[13px] text-ink-soft">
                  Type <span className="rounded bg-[#fbeae6] px-1.5 py-0.5 font-mono text-[12px] font-semibold text-negative">DELETE</span> to confirm.
                </p>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoFocus
                  placeholder="DELETE"
                  className="mt-2 h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-ink outline-none focus:border-negative"
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={close} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
                    Cancel
                  </button>
                  <button
                    onClick={confirmDelete}
                    disabled={text !== "DELETE" || pending}
                    className="rounded-lg bg-negative px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
                  >
                    {pending ? "Deleting…" : "Delete lot permanently"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
