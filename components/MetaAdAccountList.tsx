"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeMetaAdAccount } from "@/app/settings/integrations/actions";
import { AlertTriangle } from "@/components/icons";

type Row = { accountId: string; name: string; businessName: string | null; currency: string | null; status: string; lastError: string | null };

/** The Meta ad accounts a company linked, each with its own two-step Remove (which also deletes its spend). */
export function MetaAdAccountList({ accounts }: { accounts: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<string | null>(null);
  if (!accounts.length) return <div className="mt-2 text-[12px] text-muted">No ad account linked yet.</div>;
  return (
    <ul className="mt-2 space-y-1">
      {accounts.map((a) => (
        <li key={a.accountId} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px]">
          <span className="font-medium text-ink">{a.name}</span>
          <span className="text-muted">{[a.businessName, a.currency, a.accountId.replace(/^act_/, "")].filter(Boolean).join(" · ")}</span>
          {a.status === "error" && (
            <span className="pill-red inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-medium leading-none" title={a.lastError ?? undefined}>
              <AlertTriangle size={11} /> Needs reconnect
            </span>
          )}
          <span className="ml-auto">
            {confirm === a.accountId ? (
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      try {
                        await removeMetaAdAccount(a.accountId);
                      } finally {
                        setConfirm(null);
                        router.refresh();
                      }
                    })
                  }
                  className="rounded-md bg-negative px-2 py-1 text-[11.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? "Removing…" : "Remove and delete its spend"}
                </button>
                <button type="button" onClick={() => setConfirm(null)} className="text-[11.5px] text-muted hover:text-ink-soft">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirm(a.accountId)}
                title="Stop importing this ad account and take its spend off the P&L"
                className="text-[11.5px] text-muted hover:text-negative"
              >
                Remove
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
