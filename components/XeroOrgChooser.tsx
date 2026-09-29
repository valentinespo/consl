"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { chooseXeroOrganisationAction, disconnectIntegration } from "@/app/(app)/settings/integrations/actions";

/**
 * Shown on the Xero card when several organisations were ticked on Xero's consent screen: the
 * owner picks the one this company exports to. The others are disconnected from consl.
 */
export function XeroOrgChooser({ choices }: { choices: { tenantId: string; name: string }[] | null }) {
  const router = useRouter();
  const [picked, setPicked] = useState(choices?.[0]?.tenantId ?? "");
  const [pending, setPending] = useState<"use" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "use" | "cancel") {
    setPending(kind);
    setError(null);
    try {
      const r = kind === "use" ? await chooseXeroOrganisationAction(picked) : await disconnectIntegration("xero");
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Reload to check whether it was saved.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-2.5 rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="text-[12.5px] font-medium text-ink">Which Xero organisation should this company export to?</div>
      {choices === null ? (
        <p className="mt-1.5 text-[12px] text-muted">Couldn&apos;t read the organisations from Xero. Connect Xero again.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {choices.map((c) => (
            <label key={c.tenantId} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-soft">
              <input type="radio" name="xero-org" value={c.tenantId} checked={picked === c.tenantId} onChange={() => setPicked(c.tenantId)} className="accent-[var(--color-accent)]" />
              {c.name}
            </label>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {choices !== null && choices.length > 0 && (
          <button
            type="button"
            disabled={!!pending || !picked}
            onClick={() => run("use")}
            className="rounded-lg bg-accent-strong px-3 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending === "use" ? "Connecting…" : "Use this organisation"}
          </button>
        )}
        <button type="button" disabled={!!pending} onClick={() => run("cancel")} className="text-[12.5px] text-muted hover:text-ink-soft disabled:opacity-50">
          {pending === "cancel" ? "Cancelling…" : "Cancel"}
        </button>
      </div>
      {choices !== null && choices.length > 1 && <p className="mt-2 text-[11.5px] text-muted">The other organisations are disconnected from consl.</p>}
      {error && <div className="mt-2 text-[12px] text-negative">{error}</div>}
    </div>
  );
}
