"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeMetaAdAccount } from "@/app/settings/integrations/actions";
import { AlertTriangle } from "@/components/icons";

type Row = { accountId: string; name: string; businessName: string | null; currency: string | null; status: string; lastError: string | null };

/** The Meta ad accounts a company linked, each with a two-step Remove: keep its spend on the P&L
 *  (the account stays listed as removed, and "Add ad accounts" links it again) or delete it all. */
export function MetaAdAccountList({ accounts }: { accounts: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<string | null>(null);
  if (!accounts.length) return <div className="mt-2 text-[12px] text-muted">No ad account linked yet.</div>;
  return (
    <ul className="mt-2 space-y-1">
      {accounts.map((a) => (
        <li key={a.accountId} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px]">
          <span className={`font-medium ${a.status === "removed" ? "text-muted line-through" : "text-ink"}`}>{a.name}</span>
          <span className="text-muted">{[a.businessName, a.currency, a.accountId.replace(/^act_/, "")].filter(Boolean).join(" · ")}</span>
          {a.status === "removed" && (
            <span className="pill-neutral inline-flex items-center rounded-full px-2 py-[3px] text-[11px] font-medium leading-none" title="Not imported any more; the spend it brought stays on the P&L. Link it again from “Add ad accounts”.">
              Removed · spend kept
            </span>
          )}
          {a.status === "error" && (
            <span className="pill-red inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-medium leading-none" title={a.lastError ?? undefined}>
              <AlertTriangle size={11} /> Needs reconnect
            </span>
          )}
          <span className="ml-auto">
            {confirm === a.accountId ? (
              <span className="inline-flex items-center gap-1.5">
                {a.status !== "removed" && (
                  <button
                    type="button"
                    disabled={pending}
                    title="Stops importing; every day of spend already on the P&L stays"
                    onClick={() =>
                      start(async () => {
                        try {
                          await removeMetaAdAccount(a.accountId, "keep");
                        } finally {
                          setConfirm(null);
                          router.refresh();
                        }
                      })
                    }
                    className="rounded-md bg-negative px-2 py-1 text-[11.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {pending ? "Removing…" : "Remove, keep its spend"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={pending}
                  title="Removes the account and every day of spend it brought into the P&L"
                  onClick={() =>
                    start(async () => {
                      try {
                        await removeMetaAdAccount(a.accountId, "wipe");
                      } finally {
                        setConfirm(null);
                        router.refresh();
                      }
                    })
                  }
                  className="rounded-md border border-negative bg-surface px-2 py-1 text-[11.5px] font-medium text-negative hover:bg-negative hover:text-white disabled:opacity-50"
                >
                  {pending ? "…" : a.status === "removed" ? "Delete its spend" : "Remove and delete its spend"}
                </button>
                <button type="button" onClick={() => setConfirm(null)} className="text-[11.5px] text-muted hover:text-ink-soft">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirm(a.accountId)}
                title={a.status === "removed" ? "Delete the spend this account brought" : "Stop importing this ad account — keep or delete its spend"}
                className="text-[11.5px] text-muted hover:text-negative"
              >
                {a.status === "removed" ? "Delete spend" : "Remove"}
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
