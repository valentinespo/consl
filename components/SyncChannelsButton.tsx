"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "@/components/icons";
import { syncChannels } from "@/app/inventory/actions";

/** Pull stock and sales from every connected sales channel on demand. Lives beside the Inventory
 *  tabs so the value card below can use the full width. */
export function SyncChannelsButton({ lastSync }: { lastSync: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function sync() {
    setMsg(null);
    start(async () => {
      try {
        const r = await syncChannels();
        if (r.synced.length === 0 && r.error) setMsg(r.error);
        else {
          const names = r.synced.join(", ");
          setMsg(
            r.error
              ? `Synced ${names}. ${r.error}`
              : r.salesOk
                ? `Synced ${names}.`
                : `Synced ${names} (sales lagging — kept last velocity).`,
          );
        }
      } finally {
        router.refresh();
      }
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
        {pending ? "Syncing…" : "Sync channels"}
      </button>
    </div>
  );
}
