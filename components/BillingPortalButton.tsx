"use client";

import { useState } from "react";
import { ExternalLink } from "@/components/icons";
import { openBillingPortal } from "@/app/(app)/settings/billing/actions";

export function BillingPortalButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    setPending(true);
    setError(null);
    try {
      const r = await openBillingPortal();
      if (!r.ok) setError(r.error);
      else window.location.href = r.url;
    } catch {
      setError("Something went wrong. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        onClick={open}
        disabled={pending}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3.5 text-[13px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Opening…" : "Manage billing"}
        <ExternalLink size={13} />
      </button>
      {error && <p className="mt-2 text-[12px] text-negative">{error}</p>}
    </div>
  );
}
