"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X, Lock } from "@/components/icons";

export type DeleteResult = { ok: boolean; error?: string };

/** Danger zone shared by every detail page.
 *  If anything references the record we refuse outright and say what's in the way; otherwise we
 *  require the exact name to be typed, so a destructive click is never one keystroke away. */
export function DeleteEntity({
  kind,
  name,
  usedBy,
  onDelete,
  redirectTo,
  description,
}: {
  kind: string;
  name: string;
  usedBy: Record<string, number>;
  onDelete: () => Promise<DeleteResult>;
  redirectTo: string;
  description?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blockers = Object.entries(usedBy);
  const inUse = blockers.length > 0;

  function close() {
    setOpen(false);
    setText("");
    setError(null);
  }

  async function confirm() {
    setPending(true);
    setError(null);
    const res = await onDelete();
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "Could not delete.");
      return;
    }
    close();
    router.push(redirectTo);
    router.refresh();
  }

  if (inUse) {
    return (
      <div className="mt-8 rounded-[var(--radius-card)] border border-border bg-surface-2/60 px-5 py-4">
        <div className="flex items-start gap-2.5">
          <Lock size={15} className="mt-0.5 shrink-0 text-muted" />
          <div>
            <div className="text-[13.5px] font-semibold text-ink-soft">This {kind} is in use — it can&apos;t be deleted</div>
            <div className="mt-1 text-[12.5px] text-muted">
              Deleting it would change history that already depends on it. It&apos;s currently used by:
            </div>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12.5px] text-ink-soft">
              {blockers.map(([label, n]) => (
                <li key={label}>
                  <span className="tabular font-medium">{n}</span> {label}
                </li>
              ))}
            </ul>
            <div className="mt-2 text-[12px] text-muted">Remove or reassign those first, then you can delete this {kind}.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[#e7cfc8] bg-[#fcf4f1] px-5 py-4">
      <div>
        <div className="text-[13.5px] font-semibold text-negative">Delete this {kind}</div>
        <div className="text-[12px] text-muted">{description ?? `Nothing depends on it, so it can be removed permanently.`}</div>
      </div>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#e0b3a8] bg-surface px-3.5 py-2 text-[13px] font-medium text-negative hover:bg-[#fbeae6]"
      >
        <Trash2 size={14} /> Delete {kind}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={close}>
          <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-negative">Delete {name}?</h3>
              <button onClick={close} className="text-muted hover:text-ink">
                <X size={18} />
              </button>
            </div>
            <p className="text-[13px] leading-relaxed text-ink-soft">
              This permanently deletes the {kind}. <span className="font-medium text-negative">This cannot be undone.</span>
            </p>
            <p className="mt-3 text-[13px] text-ink-soft">
              Type <span className="rounded bg-[#fbeae6] px-1.5 py-0.5 font-mono text-[12px] font-semibold text-negative">{name}</span> to confirm.
            </p>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
              placeholder={name}
              className="mt-2 h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-ink outline-none focus:border-negative"
            />
            {error && <div className="mt-2 text-[12px] text-negative">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={close} className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2">
                Cancel
              </button>
              <button
                onClick={confirm}
                disabled={text.trim() !== name || pending}
                className="rounded-lg bg-negative px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                {pending ? "Deleting…" : `Delete ${kind} permanently`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
