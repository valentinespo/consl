"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Archive, DotsVertical, Undo2, X } from "@/components/icons";
import { useCan } from "@/components/AccessProvider";
import { setCatalogItemArchived } from "@/app/(app)/catalog/actions";

/**
 * The ⋯ menu in the corner of a catalog card. On an active item it offers "Archive", behind one
 * confirmation; on an archived item it offers "Unarchive", straight away (bringing something back
 * hides nothing, so there is nothing to confirm). Only people who may edit the catalog see it.
 */
export function CatalogItemMenu({ kind, id, name, archived }: { kind: "product" | "material"; id: string; name: string; archived: boolean }) {
  const router = useRouter();
  const canEdit = useCan("catalog", "edit");
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = box !== null;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      // The menu lives in a portal, outside the button: exempt both, or a press on an item
      // unmounts the menu on mousedown and its click never fires.
      if (!btn.current?.contains(t) && !menu.current?.contains(t)) setBox(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setBox(null);
    const follow = () => setBox(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", follow, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", follow, true);
    };
  }, [open]);

  if (!canEdit) return null;

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (open) return setBox(null);
    const r = btn.current!.getBoundingClientRect();
    setBox({ top: r.bottom + 4, left: Math.max(8, r.right - 168) });
  }

  async function apply(nextArchived: boolean) {
    setPending(true);
    setError(null);
    try {
      const r = await setCatalogItemArchived(kind, id, nextArchived);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setConfirming(false);
      setBox(null);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Reload to check whether it was saved.");
    } finally {
      setPending(false);
    }
  }

  const noun = kind === "product" ? "product" : "raw material";

  return (
    <>
      <button
        ref={btn}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Options for ${name}`}
        title="Options"
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
      >
        <DotsVertical size={16} />
      </button>
      {box &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            style={{ position: "fixed", top: box.top, left: box.left, width: 168 }}
            className="dropdown-in z-[300] rounded-xl border border-border bg-surface p-1 shadow-xl"
          >
            {archived ? (
              <button
                role="menuitem"
                disabled={pending}
                onClick={() => apply(false)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-soft hover:bg-surface-2 hover:text-ink disabled:opacity-50"
              >
                <Undo2 size={14} />
                {pending ? "Restoring…" : "Unarchive"}
              </button>
            ) : (
              <button
                role="menuitem"
                onClick={() => {
                  setBox(null);
                  setError(null);
                  setConfirming(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-soft hover:bg-surface-2 hover:text-ink"
              >
                <Archive size={14} />
                Archive
              </button>
            )}
            {error && archived && <div className="px-2.5 pb-1.5 pt-0.5 text-[12px] text-negative">{error}</div>}
          </div>,
          document.body,
        )}
      {confirming &&
        createPortal(
          <div className="fixed inset-0 z-[310] flex items-center justify-center bg-black/30 p-4" onClick={() => !pending && setConfirming(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Archive ${name}`}
              className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="truncate text-[15px] font-semibold text-ink">Archive {name}?</h3>
                <button onClick={() => setConfirming(false)} disabled={pending} aria-label="Close" className="text-muted hover:text-ink">
                  <X size={18} />
                </button>
              </div>
              <p className="text-[13px] leading-relaxed text-ink-soft">
                This {noun} leaves the catalog, every dropdown and Reorder. Nothing else changes: its stock, costs, history and any new sales
                keep counting exactly as before.
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">You can bring it back any time from Archived, at the top of the catalog.</p>
              {error && <div className="mt-3 text-[12px] text-negative">{error}</div>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className="rounded-lg border border-border px-3.5 py-2 text-[13px] text-ink-soft hover:bg-surface-2"
                >
                  Cancel
                </button>
                <button
                  onClick={() => apply(true)}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
                >
                  <Archive size={14} />
                  {pending ? "Archiving…" : "Archive"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
