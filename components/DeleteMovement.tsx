"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { deleteMovement } from "@/app/facilities/actions";

/** Two-click removal for a movement. Nothing depends on it — the engine just replays without it. */
export function DeleteMovement({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          onClick={() => start(async () => { await deleteMovement(id); router.refresh(); })}
          disabled={pending}
          className="rounded-md bg-negative px-2 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "…" : "Remove"}
        </button>
        <button onClick={() => setConfirming(false)} className="text-[11px] text-muted hover:text-ink-soft">
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
