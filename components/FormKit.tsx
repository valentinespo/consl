"use client";

import { HoverHint } from "@/components/HoverHint";

/** Shared form primitives for the detail-page editors, so product / material / facility /
 *  supplier all look and behave identically. */

export const inputCls =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-ink outline-none transition-colors focus:border-accent-strong";

export function Field({
  label,
  hint,
  help,
  floatHint = false,
  hintSide = "left",
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  /** Optional "what is this?" bubble, shown as an icon before the label in the label's own colour. */
  help?: { title: string; body: string };
  /** Hint hangs below without taking layout space, so fields sharing a row never shift. */
  floatHint?: boolean;
  /** Floating only: which edge the hint hangs from ("right" for inputs at a row's end). */
  hintSide?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${floatHint ? "relative" : ""}`}>
      <span className="mb-1 flex items-center gap-1 text-[12px] font-medium text-ink-soft">
        {help && <HoverHint {...help} size={12} />}
        {label}
      </span>
      {children}
      {hint &&
        (floatHint ? (
          <span
            className={`pointer-events-none absolute top-full mt-1 block whitespace-nowrap text-[11px] text-muted ${
              hintSide === "right" ? "right-0 text-right" : "left-0"
            }`}
          >
            {hint}
          </span>
        ) : (
          <span className="mt-1 block text-[11px] text-muted">{hint}</span>
        ))}
    </label>
  );
}

/** Save / reset row. Stays disabled until something actually changed. */
export function SaveBar({
  dirty,
  pending,
  error,
  saved,
  onSave,
  onReset,
  label = "Save changes",
}: {
  dirty: boolean;
  pending: boolean;
  error: string | null;
  saved?: boolean;
  onSave: () => void;
  onReset: () => void;
  label?: string;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button
        onClick={onSave}
        disabled={!dirty || pending}
        className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Saving…" : label}
      </button>
      {dirty && !pending && (
        <button onClick={onReset} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
          Reset
        </button>
      )}
      {error && <span className="text-[12px] text-negative">{error}</span>}
      {saved && !dirty && !error && <span className="text-[12px] text-positive">Saved</span>}
    </div>
  );
}
