"use client";

import { useState } from "react";
import { AlertTriangle } from "@/components/icons";
import { Card } from "@/components/ui";
import { deleteOrganization } from "@/app/team/actions";
import { DELETE_GRACE_DAYS } from "@/lib/constants";

/**
 * Deleting a company takes everything in it with it, and there is no undo. Two deliberate steps:
 * arm the danger zone, then type the exact company name. Nothing here is a safeguard on its own —
 * the action re-checks ownership and the typed name server-side.
 */
export function DeleteOrganization({ orgName, isOwner }: { orgName: string; isOwner: boolean }) {
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = typed.trim() === orgName.trim();

  async function confirm() {
    setError(null);
    setPending(true);
    const res = await deleteOrganization(typed);
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    // Everything on screen belonged to a company that no longer exists.
    window.location.href = "/";
  }

  if (!isOwner) return null;

  return (
    <Card className="mt-4 border-[#f0d3cb]">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-negative">
        <AlertTriangle size={13} />
        Danger zone
      </div>
      <p className="mb-4 max-w-[62ch] text-[12.5px] text-muted">
        Deleting <span className="font-medium text-ink">{orgName}</span> shuts it down right away —
        it disappears for everyone and no one can open it. Its data is kept for {DELETE_GRACE_DAYS} days
        in case you want it back (reach out and we&apos;ll restore it), then it&apos;s erased for good:
        every product, lot, purchase, invoice, movement and document, with no way to recover it. Your
        other companies are unaffected.
      </p>

      {!armed ? (
        <button
          onClick={() => setArmed(true)}
          className="rounded-lg border border-[#e8bab5] bg-[#fdf2ef] px-3.5 py-2 text-[13px] font-medium text-negative hover:bg-[#fbe6e0]"
        >
          Delete this company
        </button>
      ) : (
        <div className="rounded-xl border border-[#e8bab5] bg-[#fdf2ef] p-3.5">
          <div className="text-[13px] font-medium text-ink">
            Type <span className="font-mono">{orgName}</span> to confirm
          </div>
          <p className="mt-0.5 text-[11.5px] text-muted">Recoverable for {DELETE_GRACE_DAYS} days, then permanent.</p>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches && !pending) confirm();
              if (e.key === "Escape") {
                setArmed(false);
                setTyped("");
              }
            }}
            placeholder={orgName}
            spellCheck={false}
            className="mt-2.5 h-9 w-full rounded-lg border border-[#e8bab5] bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-negative"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              onClick={confirm}
              disabled={!matches || pending}
              className="rounded-lg bg-negative px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {pending ? "Deleting…" : "Delete company"}
            </button>
            <button
              onClick={() => {
                setArmed(false);
                setTyped("");
                setError(null);
              }}
              className="rounded-lg border border-border bg-surface px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
          {error && <div className="mt-2 text-[12px] text-negative">{error}</div>}
        </div>
      )}
    </Card>
  );
}
