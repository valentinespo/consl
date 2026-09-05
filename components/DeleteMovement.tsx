"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, X } from "@/components/icons";
import { deleteMovement, movementDeleteImpact } from "@/app/facilities/actions";

/**
 * Removal for a movement — the engine just replays without it, so deleting a layer row (starting
 * balance, found stock, return) erases that stock as if it never existed and costs re-derive.
 * That's a bigger deal than it looks, so the confirm asks you to TYPE "Delete" — and if the
 * delete would leave any lot without a raw material it already consumed, a warning says exactly
 * which lot and how much before you commit. The warning is portalled to the body: the ledger
 * table's scroll container would clip an inline popover.
 */
export function DeleteMovement({ id }: { id: string }) {
  const router = useRouter();
  const anchor = useRef<HTMLSpanElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const [pending, start] = useTransition();
  const armed = text.trim().toLowerCase() === "delete";

  // The moment the confirm opens, ask the server what this delete would break.
  useEffect(() => {
    if (!confirming) {
      setWarnings([]);
      return;
    }
    let alive = true;
    movementDeleteImpact(id).then((r) => {
      if (alive && r.ok) setWarnings(r.warnings);
    });
    return () => {
      alive = false;
    };
  }, [confirming, id]);

  // Keep the portalled warning pinned under the confirm controls while it's up.
  useEffect(() => {
    if (!confirming || warnings.length === 0) {
      setBox(null);
      return;
    }
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      setBox({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right, window.innerWidth - 8) - 320) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [confirming, warnings]);

  if (confirming) {
    return (
      <span ref={anchor} className="inline-flex items-center gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Type "Delete"'
          autoFocus
          className="h-7 w-24 rounded-md border border-border bg-surface px-2 text-[11px] text-ink outline-none placeholder:text-muted focus:border-negative"
        />
        <button
          onClick={() =>
            armed &&
            start(async () => {
              await deleteMovement(id);
              router.refresh();
            })
          }
          disabled={pending || !armed}
          className="rounded-md bg-negative px-2 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "…" : "Delete"}
        </button>
        <button
          onClick={() => {
            setConfirming(false);
            setText("");
          }}
          className="text-[11px] text-muted hover:text-ink-soft"
        >
          No
        </button>
        {box &&
          warnings.length > 0 &&
          createPortal(
            <div
              style={{ position: "fixed", top: box.top, left: box.left, width: 320 }}
              className="dropdown-in z-[300] rounded-lg border tint-red px-3 py-2 text-left shadow-xl"
            >
              {warnings.map((w, i) => (
                <div key={i} className={`flex items-start gap-1.5 text-[12px] font-medium leading-snug text-negative ${i > 0 ? "mt-1.5" : ""}`}>
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>,
            document.body,
          )}
      </span>
    );
  }
  return (
    <button
      onClick={() => setConfirming(true)}
      title="Remove movement"
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-negative"
    >
      <X size={15} />
    </button>
  );
}
