"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { syncAmazon } from "@/app/inventory/actions";

/** Pull Amazon stock and sales on demand. Lives beside the Inventory tabs so the value card
 *  below can use the full width. */
export function SyncAmazonButton({ lastSync }: { lastSync: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function sync() {
    setMsg(null);
    start(async () => {
      const r = await syncAmazon();
      setMsg(
        r.ok
          ? r.salesOk
            ? "Synced with Amazon."
            : "Inventory synced (sales lagging — kept last velocity)."
          : r.error,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2.5">
      <span className="hidden text-[11.5px] text-muted sm:inline">
        {msg ?? (lastSync ? `Updated ${lastSync}` : "Never synced")}
      </span>
      <button
        onClick={sync}
        disabled={pending}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <RefreshCw size={14} className={pending ? "animate-spin" : ""} />
        {pending ? "Syncing…" : "Sync Amazon"}
      </button>
    </div>
  );
}
