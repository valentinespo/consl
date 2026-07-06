"use client";

import { Trash2 } from "lucide-react";

/**
 * A delete control that asks twice before firing — guards important, irreversible deletions.
 * step: 0 = idle button, 1 = first confirm, 2 = final "are you sure".
 */
export function TwoStepDelete({
  step,
  setStep,
  pending,
  onConfirm,
  noun = "item",
  finalWarning,
}: {
  step: number;
  setStep: (n: number) => void;
  pending: boolean;
  onConfirm: () => void;
  noun?: string;
  finalWarning?: string; // extra consequence shown on the last confirm (e.g. "also deletes Lot #21")
}) {
  if (step === 0) {
    return (
      <button
        type="button"
        onClick={() => setStep(1)}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7cfc8] px-3 py-2 text-[13px] font-medium text-negative hover:bg-[#fbf1ee] disabled:opacity-50"
      >
        <Trash2 size={14} /> Delete
      </button>
    );
  }
  if (step === 1) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-negative">Delete this {noun}?</span>
        <button type="button" onClick={() => setStep(2)} className="rounded-lg border border-[#e7cfc8] px-2.5 py-1.5 text-[12.5px] font-medium text-negative hover:bg-[#fbf1ee]">
          Continue
        </button>
        <button type="button" onClick={() => setStep(0)} className="text-[12.5px] text-muted hover:text-ink-soft">
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-negative">
        {finalWarning ? <><span className="font-semibold">{finalWarning}</span> This can&apos;t be undone.</> : <>Sure? This can&apos;t be undone.</>}
      </span>
      <button type="button" onClick={onConfirm} disabled={pending} className="rounded-lg bg-negative px-2.5 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50">
        {pending ? "Deleting…" : "Delete permanently"}
      </button>
      <button type="button" onClick={() => setStep(0)} className="text-[12.5px] text-muted hover:text-ink-soft">
        Cancel
      </button>
    </div>
  );
}
