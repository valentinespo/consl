"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "@/components/icons";
import { deleteMovement } from "@/app/facilities/actions";

/**
 * Removal for a movement — the engine just replays without it, so deleting a layer row (starting
 * balance, found stock, return) erases that stock as if it never existed and costs re-derive.
 * That's a bigger deal than it looks, so the confirm asks you to TYPE "Delete".
 */
export function DeleteMovement({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const armed = text.trim().toLowerCase() === "delete";

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5">
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
